-- Versioned, declarative page rules (a data-backed adapter).
CREATE TABLE "AutofillRuleSet" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "platformKey" TEXT,
    "sourceKey" TEXT NOT NULL,
    "origin" TEXT,
    "pathPattern" TEXT,
    "queryPolicy" TEXT NOT NULL DEFAULT 'ignore',
    "parentRuleSetId" TEXT,
    "supersedesId" TEXT,
    "versionNo" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "health" TEXT NOT NULL DEFAULT 'healthy',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "fingerprintHash" TEXT,
    "fingerprintSummary" JSONB,
    "fingerprintObservedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutofillRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutofillRuleSet_sourceKey_versionNo_key" ON "AutofillRuleSet"("sourceKey", "versionNo");
CREATE INDEX "AutofillRuleSet_sourceKey_state_idx" ON "AutofillRuleSet"("sourceKey", "state");
CREATE INDEX "AutofillRuleSet_platformKey_scope_state_idx" ON "AutofillRuleSet"("platformKey", "scope", "state");
CREATE INDEX "AutofillRuleSet_parentRuleSetId_idx" ON "AutofillRuleSet"("parentRuleSetId");
CREATE UNIQUE INDEX "AutofillRuleSet_one_published_per_source" ON "AutofillRuleSet"("sourceKey") WHERE "state" = 'published';

ALTER TABLE "AutofillRuleSet" ADD CONSTRAINT "AutofillRuleSet_parentRuleSetId_fkey"
  FOREIGN KEY ("parentRuleSetId") REFERENCES "AutofillRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutofillRuleSet" ADD CONSTRAINT "AutofillRuleSet_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "AutofillRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutofillRuleSet" ADD CONSTRAINT "AutofillRuleSet_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutofillRuleSet" ADD CONSTRAINT "AutofillRuleSet_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
