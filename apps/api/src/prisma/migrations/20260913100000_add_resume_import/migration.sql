-- CreateTable
CREATE TABLE "ResumeImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ResumeImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResumeImport_userId_idempotencyKey_key" ON "ResumeImport"("userId", "idempotencyKey");
CREATE INDEX "ResumeImport_userId_createdAt_idx" ON "ResumeImport"("userId", "createdAt");
ALTER TABLE "ResumeImport" ADD CONSTRAINT "ResumeImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
