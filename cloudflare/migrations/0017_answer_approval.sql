-- Until the job sandbox ships, a job resumes on its requester's runner with
-- another maintainer's answer only once the requester approves it. The
-- requester's own answers are approved as they are given.
ALTER TABLE job_questions ADD COLUMN approvedAt INTEGER;
-- Answers given before the gate already resumed their jobs.
UPDATE job_questions SET approvedAt=answeredAt WHERE answer IS NOT NULL;
