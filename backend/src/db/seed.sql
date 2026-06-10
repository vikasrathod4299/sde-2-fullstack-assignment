-- Users
INSERT INTO users (email, password_hash) VALUES
("alice@test.com", "$2a$10$hpKdcgXVhARindQHo7vl8ev2DjcrI8NSYar.nUs7rxxrOJEU1XNWK"),
("bob@test.com", "$2a$10$6oZTEUpliArXxAcEHOw8M.PBTNZtOz4oQ.umFsLQ8SH0BWomUzjgS");

-- Mailboxes
INSERT INTO mailboxes (user_id, email, daily_limit, hourly_limit) VALUES
  (1, 'alice@work.com', 100, 10),
  (1, 'alice@personal.com', 50, 5),
  (1, 'alice@ventures.com', 200, 20),
  (2, 'bob@work.com', 100, 10);

-- Sequences
INSERT INTO sequences (id, user_id, name, status) VALUES
  (1, 1, 'Follow-up cadence', 'active'),
  (2, 1, 'Welcome series', 'draft');

-- Steps for sequence 1
INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES
  (1, 1, 1, 0, 'Thanks for connecting', 'Hi {{name}}, thanks for connecting! Look forward to chatting.'),
  (2, 1, 2, 2, 'Following up', 'Hi {{name}}, just checking in. Any thoughts on our conversation?'),
  (3, 1, 3, 5, 'One more thing', 'Hi {{name}}, wanted to share one more resource with you.');

-- Steps for sequence 2
INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES
  (4, 2, 1, 0, 'Welcome!', 'Hi {{name}}, welcome to our platform!'),
  (5, 2, 2, 3, 'Getting started', 'Hi {{name}}, here are some tips to get started.');

-- Prospects for sequence 1
INSERT INTO prospects (id, sequence_id, email, name, status) VALUES
  (1, 1, 'john@example.com', 'John', 'active'),
  (2, 1, 'jane@example.com', 'Jane', 'active'),
  (3, 1, 'bob@example.com', NULL, 'active');

-- Prospects for sequence 2
INSERT INTO prospects (id, sequence_id, email, name, status) VALUES
  (4, 2, 'sam@example.com', 'Sam', 'active'),
  (5, 2, 'tina@example.com', 'Tina', 'unsubscribed');
