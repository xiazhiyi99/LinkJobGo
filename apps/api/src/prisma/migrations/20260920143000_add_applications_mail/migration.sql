-- Applications, mail accounts/messages, sync runs and follow-up tasks.
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isUserEdited" BOOLEAN NOT NULL DEFAULT false,
    "appliedOn" TIMESTAMP(3),
    "eventStart" TIMESTAMP(3),
    "eventEnd" TIMESTAMP(3),
    "assessmentUrl" TEXT,
    "interviewUrl" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "nextAction" TEXT,
    "nextActionUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Application_userId_updatedAt_idx" ON "Application"("userId", "updatedAt");
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");
CREATE UNIQUE INDEX "Application_userId_idempotencyKey_key" ON "Application"("userId", "idempotencyKey");
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "source" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApplicationEvent_userId_clientEventId_key" ON "ApplicationEvent"("userId", "clientEventId");
CREATE INDEX "ApplicationEvent_userId_applicationId_occurredAt_idx" ON "ApplicationEvent"("userId", "applicationId", "occurredAt");
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'follow_up',
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "url" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Task_userId_status_dueAt_idx" ON "Task"("userId", "status", "dueAt");
CREATE INDEX "Task_userId_applicationId_idx" ON "Task"("userId", "applicationId");
CREATE UNIQUE INDEX "Task_userId_idempotencyKey_key" ON "Task"("userId", "idempotencyKey");
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "authType" TEXT NOT NULL,
    "credentialCiphertext" TEXT,
    "credentialIv" TEXT,
    "credentialTag" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailAccount_userId_provider_email_key" ON "MailAccount"("userId", "provider", "email");
CREATE INDEX "MailAccount_userId_updatedAt_idx" ON "MailAccount"("userId", "updatedAt");
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "bodyText" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "isJobRelated" BOOLEAN,
    "classificationSource" TEXT,
    "classificationVersion" TEXT,
    "classificationReason" TEXT,
    "aiResult" JSONB,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailMessage_mailAccountId_providerMessageId_key" ON "MailMessage"("mailAccountId", "providerMessageId");
CREATE INDEX "MailMessage_userId_receivedAt_idx" ON "MailMessage"("userId", "receivedAt");
CREATE INDEX "MailMessage_userId_isJobRelated_idx" ON "MailMessage"("userId", "isJobRelated");
CREATE INDEX "MailMessage_userId_applicationId_idx" ON "MailMessage"("userId", "applicationId");
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "rangeDays" INTEGER NOT NULL DEFAULT 7,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncRun_userId_idempotencyKey_key" ON "SyncRun"("userId", "idempotencyKey");
CREATE INDEX "SyncRun_userId_createdAt_idx" ON "SyncRun"("userId", "createdAt");
CREATE INDEX "SyncRun_mailAccountId_status_idx" ON "SyncRun"("mailAccountId", "status");
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
