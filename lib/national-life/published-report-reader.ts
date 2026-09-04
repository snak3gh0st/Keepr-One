import type { Prisma, PrismaClient } from '@prisma/client'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'

/** Local reports become visible only after reconciliation. Retired scopes keep
 * their original storage; the predicates never admit local landing pages. */
export async function readNationalLifeReports(
  db: Pick<PrismaClient, 'nationalLifePublishedReportRow' | 'nationalLifeReportRow'>,
  where: Prisma.NationalLifeReportRowWhereInput,
) {
  const [published, legacy] = await Promise.all([
    db.nationalLifePublishedReportRow.findMany({
      where: { AND: [where as Prisma.NationalLifePublishedReportRowWhereInput, { deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE }] },
      orderBy: [{ fetchedAt: 'desc' }, { id: 'asc' }],
    }),
    db.nationalLifeReportRow.findMany({
      where: { AND: [where, { deploymentScope: { not: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } }] },
      orderBy: [{ fetchedAt: 'desc' }, { id: 'asc' }],
    }),
  ])
  return [...published, ...legacy]
}
