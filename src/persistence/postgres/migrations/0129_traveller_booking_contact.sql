-- R4-F2 (0129): the Atlas sandbox REJECTS order creation without a valid contact
-- email (provider status 323, observed live). The contact channel VALUE in
-- traveller_contacts is a protected reference with no resolver, so the protected
-- execution input contract carries the booking contact email explicitly.
-- Same protection class as 0128 traveller_booking_identities: read only by the
-- external execution boundary after the stored authority gate.
ALTER TABLE traveller_booking_identities
  ADD COLUMN contact_email text
    CHECK (contact_email IS NULL OR (length(contact_email) <= 254 AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
