// Camblish Online Exam: live video between learners (laptop + phone) and invigilators
// Uses Supabase Realtime broadcast for signalling and WebRTC peer-to-peer for media.
// Author: Eddie Bila
const rid = () => Math.random().toString(36).slice(2, 10);

// Learner side (laptop or phone): sends its streams to every invigilator who says hello.
class LiveSender {
  constructor({ examId, attemptId, role, name }) {
    Object.assign(this, { examId, attemptId, role, name });
    this.peerId = `L:${role}:${attemptId}:${rid()}`;
    this.pcs = new Map();
    this.streams = {}; // {cam: MediaStream, screen: MediaStream}
    this.handlers = {};
  }
  on(type, f) { this.handlers[type] = f; return this; }
  setStreams(streams) { this.streams = streams; this.pcs.forEach((pc, id) => { pc.close(); this.pcs.delete(id); }); this.announce(); }
  async start() {
    this.ch = sb.channel('exm-live-' + this.examId, { config: { broadcast: { self: false } } });
    this.ch.on('broadcast', { event: 'sig' }, ({ payload: p }) => this.onSig(p).catch(e => console.warn('live', e)));
    await new Promise(res => this.ch.subscribe(st => { if (st === 'SUBSCRIBED') res(); }));
    this.announce();
    this.timer = setInterval(() => this.announce(), 45000);
  }
  send(p) { if (this.ch) this.ch.send({ type: 'broadcast', event: 'sig', payload: { ...p, from: this.peerId } }); }
  announce() { this.send({ type: 'present', attemptId: this.attemptId, role: this.role, name: this.name }); }
  flag(ev) { this.send({ type: 'flag', attemptId: this.attemptId, role: this.role, name: this.name, ...ev, at: new Date().toISOString() }); }
  async onSig(p) {
    if (p.type === 'warn' && p.attemptId === this.attemptId) return this.handlers.warn && this.handlers.warn(p);
    if (p.type === 'extend' && p.attemptId === this.attemptId) return this.handlers.extend && this.handlers.extend(p);
    if (p.type === 'end' && p.attemptId === this.attemptId) return this.handlers.end && this.handlers.end(p);
    if (p.to && p.to !== this.peerId) return;
    if (p.type === 'hello') return this.connect(p.from);
    const pc = this.pcs.get(p.from);
    if (!pc) return;
    if (p.type === 'answer') await pc.setRemoteDescription(p.sdp);
    else if (p.type === 'ice' && p.cand) { try { await pc.addIceCandidate(p.cand); } catch (e) { } }
    else if (p.type === 'bye') { pc.close(); this.pcs.delete(p.from); }
  }
  async connect(invId) {
    const old = this.pcs.get(invId);
    if (old) {
      const st = old.connectionState;
      if (st === 'connected' || st === 'connecting' || (st === 'new' && Date.now() - old._fresh < 15000)) return;
      old.close();
    }
    const pc = new RTCPeerConnection({ iceServers: CFG.STUN });
    pc._fresh = Date.now();
    this.pcs.set(invId, pc);
    const ids = {};
    for (const [kind, st] of Object.entries(this.streams)) {
      if (!st) continue;
      ids[kind] = st.id;
      st.getTracks().forEach(t => {
        if (t.readyState !== 'live') return;
        const s = pc.addTrack(t, st);
        s._kind = kind; s._isVideo = t.kind === 'video';
      });
    }
    pc.onicecandidate = e => e.candidate && this.send({ type: 'ice', to: invId, cand: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) { if (this.pcs.get(invId) === pc) this.pcs.delete(invId); }
      if (pc.connectionState === 'connected') this.capBitrates(pc);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: 'offer', to: invId, attemptId: this.attemptId, role: this.role, name: this.name, streams: ids, sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
  }
  async capBitrates(pc) {
    for (const s of pc.getSenders()) {
      if (!s.track || s.track.kind !== 'video') continue;
      try {
        const p = s.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
        if (s._kind === 'screen') { p.encodings[0].maxBitrate = 350000; p.encodings[0].maxFramerate = 4; }
        else if (this.role === 'phone') { p.encodings[0].maxBitrate = 200000; p.encodings[0].maxFramerate = 10; }
        else { p.encodings[0].maxBitrate = 180000; p.encodings[0].maxFramerate = 12; }
        await s.setParameters(p);
      } catch (e) { }
    }
  }
  stop() {
    clearInterval(this.timer);
    this.pcs.forEach((pc, id) => { this.send({ type: 'bye', to: id }); pc.close(); });
    this.pcs.clear();
    if (this.ch) { sb.removeChannel(this.ch); this.ch = null; }
  }
}

// Invigilator side: receives streams from every learner device in the exam.
class LiveReceiver {
  constructor(examId) {
    this.examId = examId; this.peerId = `I:${rid()}`; this.pcs = new Map(); this.handlers = {};
  }
  on(type, f) { this.handlers[type] = f; return this; }
  async start() {
    this.ch = sb.channel('exm-live-' + this.examId, { config: { broadcast: { self: false } } });
    this.ch.on('broadcast', { event: 'sig' }, ({ payload: p }) => this.onSig(p).catch(e => console.warn('live', e)));
    await new Promise(res => this.ch.subscribe(st => { if (st === 'SUBSCRIBED') res(); }));
    this.hello();
    this.timer = setInterval(() => this.watchdog(), 20000);
  }
  send(p) { if (this.ch) this.ch.send({ type: 'broadcast', event: 'sig', payload: { ...p, from: this.peerId } }); }
  hello(to) { this.send({ type: 'hello', ...(to ? { to } : {}) }); }
  warn(attemptId, message) { this.send({ type: 'warn', attemptId, message }); }
  notify(type, attemptId, extra = {}) { this.send({ type, attemptId, ...extra }); }
  watchdog() {
    this.pcs.forEach((pc, id) => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) { pc.close(); this.pcs.delete(id); this.hello(id.split('|')[0]); } });
  }
  async onSig(p) {
    if (p.type === 'flag') return this.handlers.flag && this.handlers.flag(p);
    if (p.type === 'present') { if (this.handlers.present) this.handlers.present(p); return this.hello(p.from); }
    if (p.to !== this.peerId) return;
    if (p.type === 'offer') {
      const old = this.pcs.get(p.from); if (old) old.close();
      const pc = new RTCPeerConnection({ iceServers: CFG.STUN });
      this.pcs.set(p.from, pc);
      pc._meta = { attemptId: p.attemptId, role: p.role, name: p.name, streams: p.streams || {} };
      const got = {};
      pc.ontrack = e => {
        const st = e.streams[0]; if (!st) return;
        const kind = Object.entries(pc._meta.streams).find(([k, id]) => id === st.id);
        const k = kind ? kind[0] : (e.track.kind === 'audio' ? 'cam' : 'cam');
        got[k] = st;
        this.handlers.stream && this.handlers.stream({ attemptId: p.attemptId, role: p.role, kind: k, stream: st, peer: p.from });
      };
      pc.onicecandidate = e => e.candidate && this.send({ type: 'ice', to: p.from, cand: e.candidate.toJSON() });
      pc.onconnectionstatechange = () => this.handlers.state && this.handlers.state({ attemptId: p.attemptId, role: p.role, state: pc.connectionState });
      await pc.setRemoteDescription(p.sdp);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      this.send({ type: 'answer', to: p.from, sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
    } else if (p.type === 'ice') {
      const pc = this.pcs.get(p.from); if (pc && p.cand) { try { await pc.addIceCandidate(p.cand); } catch (e) { } }
    } else if (p.type === 'bye') {
      const pc = this.pcs.get(p.from); if (pc) { pc.close(); this.pcs.delete(p.from); }
      this.handlers.gone && this.handlers.gone({ peer: p.from });
    }
  }
  stop() { clearInterval(this.timer); this.pcs.forEach(pc => pc.close()); this.pcs.clear(); if (this.ch) { sb.removeChannel(this.ch); this.ch = null; } }
}
