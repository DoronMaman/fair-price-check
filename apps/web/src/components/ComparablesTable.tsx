import {
  PROPERTY_TYPE_LABELS_HE,
  SOURCE_LABELS_HE,
  formatDealDate,
  formatInt,
  formatNis,
  type AnalysisResult,
  type Comparable,
} from '@fpc/shared';

const th = 'px-3 py-2 text-start text-xs font-semibold text-stone-600 whitespace-nowrap';
const td = 'px-3 py-2 whitespace-nowrap';
const dash = '—';

function Row({ c }: { c: Comparable }) {
  return (
    <tr className="border-t border-stone-100">
      <td className={`${td} font-mono text-xs`}>
        <bdi>{c.dealId}</bdi>
      </td>
      <td className={td}>
        <bdi>{formatDealDate(c.dealDate, c.datePrecision)}</bdi>
      </td>
      <td className={td}>{c.rooms ?? dash}</td>
      <td className={td}>{c.sizeSqm !== null ? formatInt(c.sizeSqm) : dash}</td>
      <td className={`${td} font-medium`}>
        <bdi>{formatNis(c.priceNis)}</bdi>
      </td>
      <td className={td}>
        <bdi>{c.pricePerSqm !== null ? formatNis(c.pricePerSqm) : dash}</bdi>
      </td>
      <td className={td}>{SOURCE_LABELS_HE[c.source]}</td>
      <td className={td}>{c.neighborhood ?? dash}</td>
      <td className={td}>{PROPERTY_TYPE_LABELS_HE[c.propertyType]}</td>
    </tr>
  );
}

export function ComparablesTable({ analysis }: { analysis: AnalysisResult }) {
  const { comparables, excludedOutliers, nComps } = analysis;
  if (comparables.length === 0) return null;

  return (
    <section
      aria-labelledby="comps-title"
      className="space-y-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200"
    >
      <h2 id="comps-title" className="text-lg font-bold">
        העסקאות הדומות ביותר
      </h2>
      <p className="text-sm text-stone-600">
        <bdi>{comparables.length}</bdi> מתוך <bdi>{nComps}</bdi> העסקאות שעליהן מבוסס החישוב, לפי דמיון בחדרים, שטח,
        סוג, שכונה ועדכניות.
      </p>
      <p className="text-xs text-stone-500 sm:hidden" aria-hidden="true">
        גללו את הטבלה הצידה לעמודות נוספות
      </p>
      {/* The table scrolls inside its card on small screens; the page itself never scrolls sideways. */}
      <div className="-mx-5 overflow-x-auto px-5" tabIndex={0} role="region" aria-labelledby="comps-title">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className={th}>
                מזהה עסקה
              </th>
              <th scope="col" className={th}>
                תאריך
              </th>
              <th scope="col" className={th}>
                חדרים
              </th>
              <th scope="col" className={th}>
                מ״ר
              </th>
              <th scope="col" className={th}>
                מחיר
              </th>
              <th scope="col" className={th}>
                ₪ למ״ר
              </th>
              <th scope="col" className={th}>
                מקור
              </th>
              <th scope="col" className={th}>
                שכונה
              </th>
              <th scope="col" className={th}>
                סוג
              </th>
            </tr>
          </thead>
          <tbody>
            {comparables.map((c) => (
              <Row key={c.dealId} c={c} />
            ))}
          </tbody>
        </table>
      </div>
      {excludedOutliers.length > 0 && (
        <p className="text-xs text-stone-600">
          לא נכללו בחישוב בגלל מחיר חריג:{' '}
          {excludedOutliers.map((o, i) => (
            <span key={o.dealId}>
              {i > 0 && ', '}
              <bdi className="font-mono">{o.dealId}</bdi> (<bdi>{formatNis(o.priceNis)}</bdi>)
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
