import { sql as raw } from 'drizzle-orm';
import { closeDb, db } from './client.js';
import { crises } from './schema.js';

/**
 * Seed cohort — countries with an active humanitarian response as of the
 * 2025/2026 Global Humanitarian Overview appeal cycle.
 *
 * This list defines the comparison cohort, and normalization is cohort-relative,
 * so adding or removing a country shifts everyone else's scores. Change it
 * deliberately, not casually.
 */
const SEED_CRISES: { iso3: string; name: string; region: string }[] = [
  { iso3: 'AFG', name: 'Afghanistan', region: 'Asia' },
  { iso3: 'BFA', name: 'Burkina Faso', region: 'Africa' },
  { iso3: 'CAF', name: 'Central African Republic', region: 'Africa' },
  { iso3: 'CMR', name: 'Cameroon', region: 'Africa' },
  { iso3: 'COD', name: 'Democratic Republic of the Congo', region: 'Africa' },
  { iso3: 'COL', name: 'Colombia', region: 'Americas' },
  { iso3: 'ETH', name: 'Ethiopia', region: 'Africa' },
  { iso3: 'HTI', name: 'Haiti', region: 'Americas' },
  { iso3: 'IRQ', name: 'Iraq', region: 'Middle East' },
  { iso3: 'LBN', name: 'Lebanon', region: 'Middle East' },
  { iso3: 'LBY', name: 'Libya', region: 'Middle East' },
  { iso3: 'MLI', name: 'Mali', region: 'Africa' },
  { iso3: 'MMR', name: 'Myanmar', region: 'Asia' },
  { iso3: 'MOZ', name: 'Mozambique', region: 'Africa' },
  { iso3: 'NER', name: 'Niger', region: 'Africa' },
  { iso3: 'NGA', name: 'Nigeria', region: 'Africa' },
  { iso3: 'PSE', name: 'Occupied Palestinian Territory', region: 'Middle East' },
  { iso3: 'SDN', name: 'Sudan', region: 'Africa' },
  { iso3: 'SOM', name: 'Somalia', region: 'Africa' },
  { iso3: 'SSD', name: 'South Sudan', region: 'Africa' },
  { iso3: 'SYR', name: 'Syrian Arab Republic', region: 'Middle East' },
  { iso3: 'TCD', name: 'Chad', region: 'Africa' },
  { iso3: 'UKR', name: 'Ukraine', region: 'Europe' },
  { iso3: 'VEN', name: 'Venezuela', region: 'Americas' },
  { iso3: 'YEM', name: 'Yemen', region: 'Middle East' },
  { iso3: 'ZWE', name: 'Zimbabwe', region: 'Africa' },
];

async function main(): Promise<void> {
  console.log(`Seeding ${SEED_CRISES.length} crises...`);

  // Idempotent: re-seeding refreshes names/regions without duplicating rows or
  // clobbering is_active, which an operator may have set by hand.
  await db
    .insert(crises)
    .values(SEED_CRISES)
    .onConflictDoUpdate({
      target: crises.iso3,
      set: {
        name: raw`excluded.name`,
        region: raw`excluded.region`,
        updatedAt: raw`now()`,
      },
    });

  const [row] = await db.select({ count: raw<string>`count(*)` }).from(crises);
  console.log(`Seed complete. ${row?.count ?? '0'} crises in table.`);

  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error('Seed failed:', error);
  await closeDb().catch(() => {});
  process.exit(1);
});
