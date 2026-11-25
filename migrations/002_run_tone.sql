ALTER TABLE runs ADD COLUMN tone TEXT CHECK (tone IN ('formal', 'warm', 'direct'));
