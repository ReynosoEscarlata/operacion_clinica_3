-- CreateTable
CREATE TABLE "DeadLetterEntry" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadLetterEntry_eventType_idx" ON "DeadLetterEntry"("eventType");
