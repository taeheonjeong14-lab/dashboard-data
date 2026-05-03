-- CreateTable
CREATE TABLE "pre_consultations" (
    "id" TEXT NOT NULL,
    "patientName" TEXT,
    "guardianName" TEXT,
    "tallyData" JSONB NOT NULL,
    "tallyResponseId" TEXT,
    "questions" JSONB,
    "geminiRawResponse" TEXT,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "consultationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "patientName" TEXT,
    "guardianName" TEXT,
    "visitType" TEXT,
    "previousChartContent" TEXT,
    "preConsultationId" TEXT,
    "transcript" TEXT NOT NULL,
    "cc" TEXT,
    "summary" TEXT,
    "ddx" TEXT,
    "realtimeQuestions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'recording',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pre_consultations_tallyResponseId_key" ON "pre_consultations"("tallyResponseId");

-- CreateIndex
CREATE UNIQUE INDEX "pre_consultations_consultationId_key" ON "pre_consultations"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "consultations_sessionId_key" ON "consultations"("sessionId");

-- AddForeignKey
ALTER TABLE "pre_consultations" ADD CONSTRAINT "pre_consultations_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
