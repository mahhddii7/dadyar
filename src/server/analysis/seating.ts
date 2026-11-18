import "server-only";
import { seatFields, type SeatField, type SeatMapping, type SeatMappings, type SeatReport, type SeatSource, type SeatScenario } from "@/types/seating";
import type { AnalysisResult, QueryPlan, SourceFile, TableRow } from "../storage/types";

const digits = (v: string) => v.replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const key = (v: unknown) => digits(String(v ?? "").normalize("NFKC")).toLowerCase().replace(/ي|ى/g,"ی").replace(/ك/g,"ک").replace(/[\s._\-‌ـ]+/gu,"");
// Preserve minus signs and identifier punctuation (e.g. basement -1 versus floor 1).
const identity = (v: string) => digits(v.normalize("NFKC")).trim().replace(/\s+/g," ").replace(/ي|ى/g,"ی").replace(/ك/g,"ک").toLowerCase();
const fmt = (v: number) => v.toLocaleString("fa-IR");
const aliases: Record<SeatField, string[]> = {
  building: ["ساختمان","نام ساختمان","building","buildingName","siteName","buildingTitle","ساختمـان محل استقرار","building.name","building.title"],
  floor: ["طبقه","نام طبقه","شماره طبقه","floor","floorName","floorNumber","floorTitle","level","floor.title"],
  capacity: ["ظرفیت","ظرفیت کل","ظرفیت سیت","تعداد کل صندلی","ظرفیت قابل استفاده","تعداد سیت","تعداد صندلی","کل سیت","تعداد کل سیت","ظرفیت صندلی","capacity","seatCapacity","totalSeats","seatCount","availableCapacityTotal","تعداد جایگاه"],
  people: ["افراد","تعداد افراد","تعداد نفرات","تعداد کارکنان","تعداد پرسنل","تعداد افراد مستقر","سیت اشغال شده","تعداد سیت اشغال شده","headcount","people","employeesCount","employeeCount","staffCount","occupiedSeats","usedSeats","personCount","requiredSeats"],
  free: ["سیت آزاد","تعداد سیت آزاد","سیت خالی","تعداد سیت خالی","صندلی خالی","freeSeats","vacantSeats","emptySeats"],
  seat: ["شناسه سیت","شماره سیت","کد سیت","شماره صندلی","شناسه صندلی","seatId","seatCode","seatNumber","deskId","deskNumber"],
  status: ["وضعیت سیت","وضعیت صندلی","وضعیت تخصیص","seatStatus","occupancyStatus","isOccupied","seat.status"],
  occupant: ["کد پرسنلی","نام کارمند","نام و نام خانوادگی","نام شخص مستقر","personnelCode","employeeId","employeeName","occupant","occupantName","assignedTo"],
};

export function isSeatReleaseQuestion(question: string) {
  const q = key(question);
  return /ساختمان|طبقه|building|floor/.test(q) && /پسبد|پسبگ|پسداد|پسمید|پسده|واگذار|تخلیه|آزادکن|برگرد[او]|تحویل[بد]|release|vacate|giveup|close/.test(q);
}

// Some JSON exports store building and employee as nested objects. Preserve a
// readable field path and use the same paths for automatic and manual mapping.
function prepareRows(source: SourceFile) {
  const base = source.rows ?? [];
  if (!base.some(row => Object.values(row).some(v => v !== null && typeof v === "object"))) {
    return { rows: base, columns: source.columns ?? [] };
  }
  const columns = new Set<string>();
  const rows = base.map(row => {
    const flat: TableRow = { ...row };
    function expand(value: unknown, path: string, depth: number) {
      if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6) return;
      for (const [child,v] of Object.entries(value)) {
        const field = path + " › " + child;
        if (field in flat) continue;
        if (v !== null && typeof v === "object") expand(v,field,depth+1);
        else { flat[field] = v; columns.add(field); }
      }
    }
    for (const [field,v] of Object.entries(row)) {
      if (v !== null && typeof v === "object") expand(v,field,1);
      else if (v !== null && v !== undefined) columns.add(field);
    }
    return flat;
  });
  return { rows, columns: [...columns].filter(c => !c.startsWith("__")) };
}

function suggest(columns: string[]): SeatMapping {
  const mapping: SeatMapping = { mode: "counts" };
  for (const field of Object.keys(seatFields) as SeatField[]) {
    const accepted = new Set(aliases[field].map(key));
    const matches = columns.filter(c => accepted.has(key(c.replaceAll(" › ","."))));
    if (matches.length === 1) mapping[field] = matches[0];
  }
  if (!mapping.building) mapping.building = columns.find(c => ["buildingid","کدساختمان"].includes(key(c)));
  if (!mapping.floor) mapping.floor = columns.find(c => ["floorid","کدطبقه"].includes(key(c)));
  // A generic status can describe a department as easily as a seat.
  if (mapping.seat && !mapping.status) mapping.status = columns.find(c => ["status","وضعیت"].includes(key(c)));
  if (!mapping.capacity && (mapping.seat || mapping.status) && !(mapping.free && mapping.people)) mapping.mode = "seats";
  return mapping;
}

class DataIssue extends Error {}
function requireData(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DataIssue(message);
}
function count(value: unknown, column: string) {
  const s = digits(String(value ?? "").trim());
  requireData(/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)(?:[.٫]0+)?$/.test(s), `«${column}» باید تعداد صحیح و نامنفی داشته باشد.`);
  const n = Number(s.replace(/[,٬]/g,"").replace("٫","."));
  requireData(Number.isSafeInteger(n), `مقدار «${column}» از محدوده محاسبه خارج است.`);
  return n;
}
function label(v: unknown) {
  return typeof v === "number" || typeof v === "string" ? String(v).trim() : "";
}
const occupied = new Set(["occupied","assigned","true","1","اشغال","اشغال شده","پر","تخصیص یافته","تخصیص داده شده","استفاده شده","مستقر"].map(key));
const vacant = new Set(["free","vacant","empty","available","unassigned","false","0","آزاد","خالی","تخصیص نیافته","بدون تخصیص"].map(key));
const unavailable = new Set(["unavailable","blocked","out of service","broken","خراب","غیر قابل استفاده","مسدود","خارج از سرویس"].map(key));

function readCounts(row: TableRow, m: SeatMapping) {
  if (m.mode === "counts") {
    const used = m.people ? count(row[m.people],m.people) : undefined;
    const free = m.free ? count(row[m.free],m.free) : undefined;
    const cap = m.capacity ? count(row[m.capacity],m.capacity) : used! + free!;
    requireData(free === undefined || free <= cap, "تعداد صندلی آزاد از ظرفیت بیشتر است.");
    requireData(used === undefined || free === undefined || used + free === cap, "جمع افراد و سیت‌های خالی با ظرفیت ثبت‌شده سازگار نیست.");
    return { cap, people: used ?? cap - free! };
  }
  const person = m.occupant ? row[m.occupant] : undefined;
  if (m.occupant) requireData(person == null || typeof person === "string" || typeof person === "number", `«${m.occupant}» باید نام یا شناسه باشد.`);
  const assigned = label(person) !== "";
  if (!m.status) return { cap: 1, people: Number(assigned) };
  const rawStatus = String(row[m.status] ?? "");
  const status = /^\s*-/.test(rawStatus) ? rawStatus : key(rawStatus);
  requireData(occupied.has(status) || vacant.has(status) || unavailable.has(status), `وضعیت «${String(row[m.status] ?? "")}» در ستون «${m.status}» مشخص نیست. از وضعیت آزاد، اشغال یا خارج از سرویس استفاده کنید.`);
  requireData(!m.occupant || assigned === occupied.has(status), "وضعیت سیت با شخص مستقر سازگار نیست.");
  return { cap: Number(!unavailable.has(status)), people: Number(occupied.has(status)) };
}

type Place = { name: string; cap: number; people: number };
function add(places: Map<string,Place>, id: string, name: string, cap: number, people: number) {
  const place = places.get(id) ?? { name, cap: 0, people: 0 };
  place.cap += cap;
  place.people += people;
  places.set(id, place);
}
function scenario(label: string, places: Map<string,Place>, capacity: number, people: number): SeatScenario {
  const sorted = [...places.values()].sort((a,b) => a.cap - b.cap || a.people - b.people || a.name.localeCompare(b.name,"fa"));
  const result: SeatScenario = { label, steps: [] };
  let remaining = capacity;
  for (const place of sorted) {
    const after = remaining - place.cap;
    if (after < people) {
      result.next = { place: place.name, shortfall: people-after };
      break;
    }
    remaining = after;
    result.steps.push({ place: place.name, released: place.cap, remaining, spare: remaining-people });
  }
  return result;
}

function validateMapping(s: SeatSource) {
  const m = s.mapping;
  const fields: SeatField[] = m.mode === "counts" ? ["building","floor","capacity","people","free"] : ["building","floor","seat","status","occupant"];
  const used = fields.map(f => m[f]).filter((c): c is string => Boolean(c));
  requireData(used.every(c => s.columns.includes(c)) && new Set(used).size === used.length, "ستون‌های انتخاب‌شده باید موجود و متمایز باشند.");
  requireData(m.building, "ستون نام ساختمان مشخص نیست.");
  if (m.mode === "counts") {
    requireData([m.capacity,m.people,m.free].filter(Boolean).length >= 2, "برای ردیف‌های تعدادی، دو ستون از «ظرفیت قابل استفاده»، «تعداد افراد» و «سیت خالی» لازم است.");
  } else {
    requireData(m.status || m.occupant, "برای هر صندلی، وضعیت اشغال یا شخص مستقر لازم است.");
  }
}

export function planSeating(question: string, plan: QueryPlan, tables: SourceFile[], overrides: SeatMappings): AnalysisResult {
  const prepared = tables.map(prepareRows);
  const sources = tables.map((s,i) => {
    const columns = prepared[i].columns;
    return { id: s.id, name: s.name, columns, mapping: overrides[s.id] ?? suggest(columns) };
  });
  const report: SeatReport = { kind: "seating", sources, answer: "", scenarios: [] };
  const buildings = new Map<string,Place>(), floors = new Map<string,Place>();
  const seatKeys = new Set<string>();
  const locationOwners = new Map<string, { id: string; counts: boolean }>();
  let capacity = 0, people = 0, matchedRows = 0, floorsComplete = true;
  let location = "";
  try {
    requireData(sources.length, "برای این محاسبه یک فایل جدولی انتخاب کنید.");
    for (const [i,s] of sources.entries()) {
      const source = tables[i], m = s.mapping;
      location = s.name;
      if (!overrides[s.id] && m.seat && (m.status || m.occupant) && (m.capacity || m.free || m.people)) {
        throw new DataIssue("هم ستون‌های صندلی و هم مقادیر تعدادی وجود دارند. در تنظیم ستون‌ها مشخص کنید هر ردیف یک صندلی است یا یک گروه مستقل.");
      }
      validateMapping(s);
      requireData(source.rows?.length, "جدول ردیفی ندارد.");
      requireData(!source.warnings?.some(w => /متوقف شد|محدود شد|بارگذاری نشدند/.test(w)), "بارگذاری این جدول به سقف ردیف رسید. بخش‌های مستقل و کامل داده را انتخاب کنید.");
      for (const [index,row] of prepared[i].rows.entries()) {
        location = `${s.name}، ردیف ${fmt(Number(row.__row) || index + 1)}`;
        const building = label(row[m.building!]), floor = m.floor ? label(row[m.floor]) : "";
        requireData(building, "نام ساختمان خالی یا نامعتبر است.");
        requireData(![building,floor].some(x => /^(?:جمع|جمعکل|مجموع|کل|total|grandtotal|subtotal)$/.test(key(x))), "ردیف جمع با ردیف‌های جزئی مخلوط شده است.");
        const placeKey = JSON.stringify([identity(building),identity(floor)]);
        const owner = locationOwners.get(placeKey);
        const noSeatId = m.mode === "counts" || !m.seat;
        requireData(!owner || owner.id === s.id || (!owner.counts && !noSeatId), "این مکان در چند فایل انتخاب شده و شناسه سیت برای تطبیق آن‌ها وجود ندارد. گزارش‌های هم‌پوشان را جدا انتخاب کنید.");
        locationOwners.set(placeKey, { id: s.id, counts: noSeatId });
        if (m.mode === "seats" && m.seat) {
          const id = label(row[m.seat]);
          requireData(id, "شناسه سیت خالی است.");
          const seatKey = JSON.stringify([identity(building),identity(floor),identity(id)]);
          requireData(!seatKeys.has(seatKey), "شناسه سیت در همین ساختمان و طبقه تکراری است.");
          seatKeys.add(seatKey);
        }
        const n = readCounts(row,m);
        capacity += n.cap;
        people += n.people;
        requireData(Number.isSafeInteger(capacity) && Number.isSafeInteger(people), "مجموع از محدوده محاسبه خارج است.");
        add(buildings,identity(building),building,n.cap,n.people);
        if (floor) add(floors,placeKey,`${building}، طبقه ${floor}`,n.cap,n.people);
        else floorsComplete = false;
        matchedRows++;
      }
    }
    const lines = [`از ${fmt(matchedRows)} ردیف، ${fmt(capacity)} سیت قابل استفاده و نیاز به ${fmt(people)} سیت محاسبه شد.`];
    if (sources.some(s => s.mapping.mode === "seats")) lines.push("در فایل‌های صندلی‌به‌صندلی، هر سیت اشغال‌شده معادل یک نفر در نظر گرفته شد.");
    if (sources.some(s => s.mapping.mode === "counts")) lines.push("تعدادهای هر ردیف به‌عنوان یک گروه مستقل جمع شدند.");
    if (capacity < people) lines.push(`هم‌اکنون ${fmt(people-capacity)} سیت کم است. واگذاری پیشنهاد نمی‌شود.`);
    else {
      lines.push(`ظرفیت مازاد ${fmt(capacity-people)} سیت است. فرض محاسبه این است که هر نفر یک سیت می‌خواهد و جابه‌جایی بین مکان‌ها آزاد است.`);
      const q = key(question), wantFloors = /طبقه|floor/.test(q);
      if (!wantFloors || /ساختمان|building/.test(q)) report.scenarios.push(scenario("واگذاری ساختمان",buildings,capacity,people));
      if (wantFloors && floorsComplete) report.scenarios.push(scenario("واگذاری طبقه",floors,capacity,people));
      if (wantFloors && !floorsComplete) lines.push("برای محاسبه جداگانه طبقات، نام طبقه باید برای تمام ردیف‌ها مشخص باشد.");
      if (report.scenarios.length) lines.push("برای واگذاری بیشترین تعداد مکان، ابتدا مکان‌های کم‌ظرفیت‌تر بررسی شدند." + (report.scenarios.length > 1 ? " دو برنامه جایگزین هم هستند. فقط یکی را اجرا کنید." : ""));
      for (const sc of report.scenarios) {
        const first = sc.steps[0], last = sc.steps.at(-1);
        lines.push(first && last ? `${sc.label} از «${first.place}» شروع می‌شود. پس از ${fmt(sc.steps.length)} واگذاری، ${fmt(last.remaining)} سیت باقی می‌ماند.` : `${sc.label} ممکن نیست. با واگذاری «${sc.next?.place}» هم ${fmt(sc.next?.shortfall ?? 0)} سیت کم می‌آید.`);
      }
    }
    report.answer = lines.join("\n");
  } catch (error) {
    if (!(error instanceof DataIssue)) throw error;
    report.answer = `${location ? location + " — " : ""}${error.message}`;
  }
  return { plan, answerData: report, matchedRows, citations: report.scenarios.length || (matchedRows > 0 && matchedRows === tables.reduce((n,s) => n+(s.rows?.length ?? 0),0)) ? tables.map(s => ({ sourceId: s.id, sourceName: s.name, matchedRows: s.rows?.length })) : [] };
}
