#!/usr/bin/env node
/**
 * One-time normalization: parses the raw reference dump (algeria_cities.sql,
 * from https://github.com/ihahachi/Algeria-Cities) into this project's own
 * wilayas.json / communes.json, which are what prisma/seed.ts actually reads.
 *
 * Re-run with `npm run build:geo-data` only if algeria_cities.sql changes.
 * The source file is community-maintained and has a few known defects, fixed
 * here explicitly (see CORRECTIONS below) rather than silently at seed time.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE_PATH = fileURLToPath(new URL('./algeria_cities.sql', import.meta.url))
const WILAYAS_OUT = fileURLToPath(new URL('./wilayas.json', import.meta.url))
const COMMUNES_OUT = fileURLToPath(new URL('./communes.json', import.meta.url))

// Each INSERT row is:
// (id, commune_name_ar, commune_name_fr, daira_name_ar, daira_name_fr,
//  wilaya_code, wilaya_name_ar, wilaya_name_fr, code_commune, lat, lon)
const ROW_RE =
  /VALUES \(None, '((?:[^'\\]|'')*)', '((?:[^'\\]|'')*)', '((?:[^'\\]|'')*)', '((?:[^'\\]|'')*)', (\d+), '((?:[^'\\]|'')*)', '((?:[^'\\]|'')*)', (\d+), [\d.-]+, [\d.-]+\);/g

const unescape = (s) => s.replace(/''/g, "'")

/**
 * Known defects in the upstream dump, fixed explicitly instead of guessed at
 * seed time. Each entry is verified against the official wilaya de Béjaïa
 * commune/daira list (ONIL, "Liste Communes dairas de la wilaya de BEJAIA").
 */
const COMMUNE_CODE_CORRECTIONS = new Map([
  // "Tizi-N'berber" (daira Aokas, wilaya 06) was mis-tagged with Ait-Smail's
  // code (647); its official code is 649.
  ["6|647|Tizi-N'berber", '649'],
  // "M'cisna" (daira Seddouk, wilaya 06) was mis-tagged with Ait R'zine's
  // code (628); its official code is 609.
  ["6|628|M'cisna", '609'],
])

/**
 * Wilaya 30's rows disagree on name: some communes are tagged "Ouargla",
 * others "Touggourt" — an upstream artifact of the 2019 wilaya split (this
 * same dump already carries Touggourt separately, as code 55). Code 30 is
 * canonically Ouargla; picked explicitly here rather than by row-count
 * majority (which would wrongly favor Touggourt, 11 rows to 8).
 */
const WILAYA_NAME_OVERRIDES = new Map([['30', { nameAr: 'ورقلة', nameFr: 'Ouargla' }]])

const text = readFileSync(SOURCE_PATH, 'utf8')

const wilayas = new Map() // code -> { code, nameAr, nameFr }
const communes = [] // { wilayaCode, code, nameAr, nameFr }
const seenCommuneKeys = new Set() // `${wilayaCode}|${code}`

let match
let rowCount = 0
while ((match = ROW_RE.exec(text))) {
  rowCount++
  const [, communeNameAr, communeNameFr, , , wilayaCode, wilayaNameAr, wilayaNameFr, rawCommuneCode] = match

  const nameAr = unescape(communeNameAr)
  const nameFr = unescape(communeNameFr)

  if (!wilayas.has(wilayaCode)) {
    const override = WILAYA_NAME_OVERRIDES.get(wilayaCode)
    wilayas.set(wilayaCode, {
      code: wilayaCode,
      nameAr: override?.nameAr ?? unescape(wilayaNameAr),
      nameFr: override?.nameFr ?? unescape(wilayaNameFr),
    })
  }

  const correctionKey = `${wilayaCode}|${rawCommuneCode}|${nameFr}`
  const communeCode = COMMUNE_CODE_CORRECTIONS.get(correctionKey) ?? rawCommuneCode

  const communeKey = `${wilayaCode}|${communeCode}`
  if (seenCommuneKeys.has(communeKey)) {
    throw new Error(
      `Duplicate commune code after normalization: wilaya ${wilayaCode}, code ${communeCode} (${nameFr}). ` +
        'Add a correction to COMMUNE_CODE_CORRECTIONS.',
    )
  }
  seenCommuneKeys.add(communeKey)

  communes.push({ wilayaCode, code: communeCode, nameAr, nameFr })
}

if (rowCount !== 1541) {
  throw new Error(`Expected 1541 commune rows in the source dump, parsed ${rowCount}.`)
}
if (wilayas.size !== 69) {
  throw new Error(`Expected 69 distinct wilaya codes in the source dump, found ${wilayas.size}.`)
}

const wilayaList = [...wilayas.values()].sort((a, b) => Number(a.code) - Number(b.code))
const communeList = [...communes].sort(
  (a, b) => Number(a.wilayaCode) - Number(b.wilayaCode) || Number(a.code) - Number(b.code),
)

writeFileSync(WILAYAS_OUT, JSON.stringify(wilayaList, null, 2) + '\n', 'utf8')
writeFileSync(COMMUNES_OUT, JSON.stringify(communeList, null, 2) + '\n', 'utf8')

console.log(`Wrote ${wilayaList.length} wilayas -> ${WILAYAS_OUT}`)
console.log(`Wrote ${communeList.length} communes -> ${COMMUNES_OUT}`)
