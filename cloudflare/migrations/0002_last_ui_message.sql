ALTER TABLE users ADD COLUMN last_ui_message_id INTEGER;
CREATE TABLE IF NOT EXISTS approval_messages (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  request_type TEXT NOT NULL CHECK(request_type IN ('transaction','change')),
  reference_id INTEGER NOT NULL,
  PRIMARY KEY(chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS approval_messages_request ON approval_messages(request_type,reference_id);
