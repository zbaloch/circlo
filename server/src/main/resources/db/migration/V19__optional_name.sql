-- Sign-up asks only for a username, email and password; the name is added later in Edit profile. NULL = not set
-- (other people see the username instead).
ALTER TABLE users MODIFY name VARCHAR(50) NULL;
