-- Store only a digest of short-lived extension access tokens.
ALTER TABLE "Session" ADD COLUMN "accessTokenHash" TEXT;
CREATE UNIQUE INDEX "Session_accessTokenHash_key" ON "Session"("accessTokenHash");
