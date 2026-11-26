/**
 * Static vocabularies used by the generators.
 *
 * All lists are generic vocabulary (common given names, surnames, place names,
 * job titles). Combinations are random and do not describe real people.
 */

export const FIRST_NAMES = [
  "Aarav", "Abigail", "Adebayo", "Aiko", "Alejandro", "Alice", "Amara", "Amir", "Ana", "Anika",
  "Arjun", "Astrid", "Ava", "Benjamin", "Bianca", "Camila", "Carlos", "Chen", "Chloe", "Daniel",
  "Dmitri", "Elena", "Elias", "Emeka", "Emily", "Emma", "Ethan", "Fatima", "Felix", "Freya",
  "Gabriel", "Grace", "Hana", "Hannah", "Hiroshi", "Ibrahim", "Ingrid", "Isabella", "Ivan", "Jack",
  "James", "Jia", "Jonas", "Julia", "Kai", "Kavya", "Kenji", "Khalid", "Laila", "Lars",
  "Layla", "Leo", "Liam", "Lina", "Lucas", "Lucia", "Maya", "Mateo", "Mei", "Mia",
  "Mohammed", "Nadia", "Naomi", "Nia", "Noah", "Nora", "Oliver", "Olivia", "Omar", "Oscar",
  "Priya", "Rafael", "Ravi", "Rosa", "Ryan", "Sakura", "Samuel", "Sara", "Sebastian", "Sofia",
  "Soren", "Tariq", "Thandiwe", "Theo", "Tomas", "Valentina", "Victor", "Wei", "William", "Yara",
  "Yusuf", "Zara", "Zoe", "Aditi", "Bruno", "Clara", "Diego", "Esther", "Farah", "Hugo",
] as const;

export const LAST_NAMES = [
  "Abara", "Adeyemi", "Alvarez", "Andersson", "Bauer", "Becker", "Bennett", "Bianchi", "Brooks", "Campbell",
  "Castillo", "Chen", "Choi", "Clarke", "Costa", "Cruz", "Das", "Dubois", "Eriksen", "Evans",
  "Fernandes", "Fischer", "Fontaine", "Garcia", "Gupta", "Hansen", "Hartmann", "Hayes", "Hoffmann", "Hughes",
  "Ibrahim", "Ito", "Jansen", "Johansson", "Kapoor", "Kaur", "Kim", "Kowalski", "Kumar", "Larsen",
  "Lee", "Lopez", "Martin", "Mendes", "Meyer", "Moreau", "Morris", "Murphy", "Nakamura", "Nguyen",
  "Novak", "Okafor", "Okonkwo", "Olsen", "Park", "Patel", "Pereira", "Petrov", "Quinn", "Ramos",
  "Reddy", "Reyes", "Richter", "Rossi", "Sato", "Schmidt", "Shah", "Silva", "Singh", "Sokolov",
  "Suzuki", "Tanaka", "Torres", "Turner", "Vargas", "Verma", "Vogel", "Walker", "Wang", "Weber",
  "Williams", "Wilson", "Wong", "Yamamoto", "Yilmaz", "Young", "Zhang", "Zimmermann", "Ahmed", "Banerjee",
] as const;

export const STREET_NAMES = [
  "Maple", "Oak", "Cedar", "Willow", "Birch", "Elm", "Juniper", "Hawthorn", "Linden", "Aspen",
  "Harbor", "Meadow", "River", "Lakeview", "Hillcrest", "Sunset", "Orchard", "Granite", "Beacon", "Foundry",
  "Market", "Station", "Mill", "Bridge", "Garden", "Park", "Chapel", "Kingfisher", "Larkspur", "Ridge",
] as const;

export const STREET_SUFFIXES = ["Street", "Avenue", "Road", "Lane", "Way", "Drive", "Court", "Place", "Terrace", "Boulevard"] as const;

export interface CountryInfo {
  name: string;
  code: string;
  currency: string;
  /** Postal-code shape: 9 = digit, A = uppercase letter, other chars literal. */
  postal: string;
  cities: readonly string[];
}

export const COUNTRIES: readonly CountryInfo[] = [
  { name: "United States", code: "US", currency: "USD", postal: "99999", cities: ["Springfield", "Riverton", "Fairview", "Lakewood", "Georgetown", "Franklin", "Madison", "Oakridge"] },
  { name: "United Kingdom", code: "GB", currency: "GBP", postal: "AA9 9AA", cities: ["Ashford", "Brookhaven", "Kingsbridge", "Millbrook", "Westbury", "Northfield"] },
  { name: "Canada", code: "CA", currency: "CAD", postal: "A9A 9A9", cities: ["Maplewood", "Port Elgin", "Lakefield", "Riverside", "Fort Albany"] },
  { name: "Germany", code: "DE", currency: "EUR", postal: "99999", cities: ["Neustadt", "Altdorf", "Lindenberg", "Bergheim", "Waldkirch"] },
  { name: "France", code: "FR", currency: "EUR", postal: "99999", cities: ["Villeneuve", "Montfort", "Beaumont", "Saint-Clair", "Bellerive"] },
  { name: "India", code: "IN", currency: "INR", postal: "999999", cities: ["Rampur", "Navapur", "Shantinagar", "Devgarh", "Sundarpur"] },
  { name: "Australia", code: "AU", currency: "AUD", postal: "9999", cities: ["Kingston", "Bayview", "Greenvale", "Ashfield", "Coral Bay"] },
  { name: "Japan", code: "JP", currency: "JPY", postal: "999-9999", cities: ["Higashiyama", "Minato-cho", "Sakuragawa", "Kitamachi"] },
  { name: "Brazil", code: "BR", currency: "BRL", postal: "99999-999", cities: ["Santa Luzia", "Boa Vista", "Rio Claro", "Vila Nova"] },
  { name: "Singapore", code: "SG", currency: "SGD", postal: "999999", cities: ["Singapore"] },
  { name: "Netherlands", code: "NL", currency: "EUR", postal: "9999 AA", cities: ["Oosterhout", "Zuidbroek", "Westervoort", "Nieuwdorp"] },
  { name: "South Africa", code: "ZA", currency: "ZAR", postal: "9999", cities: ["Riverlea", "Mountain View", "Greenside", "Kloofendal"] },
  { name: "Nigeria", code: "NG", currency: "NGN", postal: "999999", cities: ["Ikeja North", "Ogbomosho East", "Riverside Estate"] },
  { name: "United Arab Emirates", code: "AE", currency: "AED", postal: "99999", cities: ["Al Noor", "Marina Heights", "Palm Gardens"] },
  { name: "Spain", code: "ES", currency: "EUR", postal: "99999", cities: ["Villaverde", "San Roque", "Valdemora", "Puerto Alto"] },
];

export const COMPANY_PREFIXES = [
  "Acme", "Northwind", "Bluepeak", "Cobalt", "Ironbridge", "Lumen", "Meridian", "Novalink", "Oakline", "Pinecrest",
  "Quantix", "Redwood", "Silverline", "Summit", "Trident", "Vertex", "Westbrook", "Brightpath", "Clearwater", "Harborview",
  "Keystone", "Lattice", "Mosaic", "Orbital", "Parallax", "Riverstone", "Stratus", "Tidewater", "Unison", "Granite",
] as const;

export const COMPANY_CORES = [
  "Analytics", "Systems", "Logistics", "Labs", "Dynamics", "Networks", "Solutions", "Industries", "Partners", "Software",
  "Health", "Energy", "Foods", "Robotics", "Media", "Capital", "Retail", "Freight", "Biotech", "Studios",
] as const;

export const COMPANY_SUFFIXES = ["Inc.", "LLC", "Ltd.", "GmbH", "Group", "Co.", "Corp.", "PLC", "Pvt. Ltd.", ""] as const;

export const DEPARTMENTS: Record<string, readonly string[]> = {
  Engineering: ["Software Engineer", "Senior Software Engineer", "Staff Engineer", "Engineering Manager", "QA Engineer", "DevOps Engineer", "Site Reliability Engineer"],
  Product: ["Product Manager", "Senior Product Manager", "Product Designer", "UX Researcher", "Product Analyst"],
  Sales: ["Account Executive", "Sales Development Representative", "Sales Manager", "Solutions Consultant"],
  Marketing: ["Marketing Specialist", "Content Strategist", "Growth Manager", "Brand Manager"],
  Finance: ["Financial Analyst", "Accountant", "Controller", "Payroll Specialist"],
  "Human Resources": ["HR Generalist", "Recruiter", "People Partner", "Learning Specialist"],
  Operations: ["Operations Analyst", "Operations Manager", "Program Manager", "Procurement Specialist"],
  "Customer Success": ["Customer Success Manager", "Support Specialist", "Implementation Consultant"],
  Legal: ["Legal Counsel", "Paralegal", "Compliance Analyst"],
  Data: ["Data Analyst", "Data Engineer", "Data Scientist", "Analytics Manager"],
};

export const DESIGNATIONS = ["Associate", "Analyst", "Senior Analyst", "Lead", "Manager", "Senior Manager", "Director", "Vice President"] as const;

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "probation", "notice_period", "terminated"] as const;
export const EMPLOYMENT_STATUS_WEIGHTS = [78, 5, 8, 4, 5] as const;

export const GENERIC_STATUSES = ["active", "inactive", "pending", "suspended", "archived"] as const;

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "SGD", "AED", "BRL", "ZAR", "CHF"] as const;

export const WORDS = [
  "alpha", "amber", "anchor", "arc", "atlas", "beacon", "binary", "bloom", "bridge", "canvas",
  "cedar", "circuit", "cloud", "comet", "copper", "delta", "drift", "echo", "ember", "falcon",
  "field", "flux", "forge", "frame", "glacier", "harbor", "horizon", "island", "jade", "kernel",
  "lantern", "ledger", "lumen", "matrix", "meadow", "mesa", "nimbus", "nova", "orbit", "pixel",
  "prism", "quartz", "relay", "ridge", "river", "signal", "solar", "spark", "summit", "tide",
  "timber", "vector", "velvet", "vertex", "willow", "zenith",
] as const;

/** RFC 2606 / RFC 6761 reserved domains suitable for test data. */
export const SAFE_EMAIL_DOMAINS = ["example.com", "example.org", "example.net", "mail.example", "test.example"] as const;
export const SAFE_URL_DOMAINS = ["example.com", "example.org", "example.net"] as const;

export const URL_PATHS = ["products", "users", "orders", "docs", "blog", "help", "api/v1/items", "settings", "account", "catalog"] as const;
