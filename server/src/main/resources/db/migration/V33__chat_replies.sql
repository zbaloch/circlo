-- Replying to one message in a chat (owner request 2026-11-20). The id of the message replied to, always one in the
-- same chat (checked when sending). No foreign key: when that message is deleted the reply stays and shows that its
-- quote is gone.
ALTER TABLE chat_messages ADD COLUMN reply_to BINARY(16) NULL;
