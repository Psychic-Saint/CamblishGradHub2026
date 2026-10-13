# Camblish Online Exam

Proctored online assessment centre for Camblish Training Institute.
Author: Eddie Bila

**Live page:** `/exam/` on this site (for example https://psychic-saint.github.io/CamblishGradHub2026/exam/).

## What it does
- Learner sign-up and sign-in (admin: bilae@camblish.co.za), roles for invigilators and markers
- Upload a question paper and memorandum as Word, PDF or JSON; questions are detected automatically
- Pre-exam checks: Chrome on Windows or macOS, single screen, camera, microphone, full-screen share, ID photo
- Timed exam (default 3 hours plus 15 minutes grace, then automatic submission) with a built-in Python and SQL workspace
- Live invigilation: screen, webcam and phone side camera per learner, automatic alerts and evidence
- Every learner gets their own question and MCQ option order, reshuffled whenever they leave the exam screen or their phone moves
- Auto-marking of every question against the memo (key figures, concepts and code techniques), confirmed by the assessor
- Assessor, facilitator and moderator e-signatures, printed on learner and class reports
- Marking against the memo, results release, branded emailed reports and PDF / CSV exports

## Layout
- `index.html` is the complete app (one file, built from `source/app`)
- `source/app` holds the front-end modules; run `python build.py` inside `source/` to rebuild `index.html`
- `source/backend` holds the Supabase SQL and the `exam-files` edge function (project jrbihuegqydoqnsxxvma, tables prefixed `exm_`)

Question papers, memoranda and datasets are never stored in this public repository. They are uploaded through the app and kept in private Supabase storage.
