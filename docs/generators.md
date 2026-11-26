# Generator reference

Generated from the registry (generator version 1.0.0) by `scripts/generators-doc.mjs`. Use a generator by name (`"email"`) or with options (`{ "type": "integer", "min": 1, "max": 9 }`). Every field also accepts the common options `nullable`, `optional`, `unique`, `wrap` and `description` (see the [schema guide](schema.md)).

Values that look like personal or secret data are always safe by construction: emails and URLs use reserved RFC 2606 domains, phones use fictional ranges, IPs use documentation ranges, card numbers fail the Luhn check, government identifiers use never-issued prefixes, and secrets are obvious placeholders.

## Personal

### `firstName`

A given name from a diverse international list.

No options.

### `lastName`

A family name from a diverse international list.

No options.

### `fullName`

First and last name. Reuses sibling firstName/lastName fields when present.

No options.

### `email`

An email address on a reserved test domain (RFC 2606), derived from sibling name fields when present.

| Option | Type | Default |
|---|---|---|
| `domain` | string |  |

### `phone`

A phone number from fictional/reserved ranges: US 555-0100..0199 (NANP fictional) or UK 07700 900000..900999 (Ofcom drama range).

| Option | Type | Default |
|---|---|---|
| `country` | `"US"` \| `"GB"` |  |
| `format` | `"international"` \| `"national"` \| `"e164"` | `"international"` |

### `street`

A street line such as "42 Maple Avenue".

No options.

### `city`

A plausible (often fictional) city name.

| Option | Type | Default |
|---|---|---|
| `country` | string |  |

### `country`

A country name.

No options.

### `countryCode`

An ISO 3166-1 alpha-2 country code.

No options.

### `postalCode`

A postal code in the country's format (random digits/letters).

| Option | Type | Default |
|---|---|---|
| `country` | string |  |
| `shape` | string |  |

### `address`

A full postal address, as a single string or an object.

| Option | Type | Default |
|---|---|---|
| `country` | string |  |
| `format` | `"string"` \| `"object"` | `"string"` |

### `dateOfBirth`

A date of birth (YYYY-MM-DD) for an age between minAge and maxAge at the reference date.

| Option | Type | Default |
|---|---|---|
| `minAge` | integer (min 0, max 130) | `18` |
| `maxAge` | integer (min 0, max 130) | `75` |

## Professional

### `company`

A fictional company name such as "Cobalt Logistics Ltd.".

No options.

### `department`

A department name.

| Option | Type | Default |
|---|---|---|
| `values` | array |  |

### `jobTitle`

A job title. Consistent with a sibling department field when present.

No options.

### `designation`

A seniority designation (Associate ... Vice President), skewed toward junior levels.

No options.

### `employeeId`

A sequential employee identifier such as EMP-0001. Unique within a collection.

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"EMP-"` |
| `pad` | integer (min 1, max 12) | `4` |
| `start` | integer (min 0, max 9007199254740991) | `1` |

### `employmentStatus`

Employment status with a realistic distribution (mostly active).

No options.

### `managerId`

A manager identifier placeholder. Configure a self-referencing relationship to make it point at real generated employees.

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"EMP-"` |
| `pad` | integer (min 1, max 12) | `4` |
| `max` | integer (min 1, max 9007199254740991) | `50` |

### `joiningDate`

A joining date (YYYY-MM-DD) within the last `maxYears` years of the reference date.

| Option | Type | Default |
|---|---|---|
| `maxYears` | number (min 0, max 60) | `15` |

### `salary`

An annual salary amount, normally distributed between min and max and rounded.

| Option | Type | Default |
|---|---|---|
| `min` | number (min 0) | `30000` |
| `max` | number (min 0) | `180000` |
| `roundTo` | number | `500` |
| `distribution` | `"uniform"` \| `"normal"` \| `"exponential"` | `"normal"` |
| `mean` | number |  |
| `stddev` | number |  |

### `salaryStructure`

A salary breakdown object: base, bonus, allowances, total and currency.

| Option | Type | Default |
|---|---|---|
| `min` | number (min 0) | `30000` |
| `max` | number (min 0) | `180000` |
| `currency` | string |  |

### `currency`

An ISO 4217 currency code.

No options.

### `status`

A generic lifecycle status (active, inactive, pending ...).

| Option | Type | Default |
|---|---|---|
| `values` | array |  |

## Technical

### `username`

A username, derived from sibling name fields when present.

No options.

### `uuid`

A random-format (version 4 layout) UUID derived from the seeded RNG.

No options.

### `objectId`

A MongoDB-style 24-hex ObjectId. With extendedJson: true, emits {"$oid": "..."}.

| Option | Type | Default |
|---|---|---|
| `extendedJson` | boolean | `false` |

### `apiId`

An opaque API resource identifier like "res_8fK2..." (base62).

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"res_"` |
| `length` | integer (min 4, max 64) | `16` |

### `productId`

A product identifier like PRD-7K3M9Q.

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"PRD-"` |
| `length` | integer (min 4, max 64) | `6` |

### `orderId`

An order identifier like ORD-4HXT8M2P.

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"ORD-"` |
| `length` | integer (min 4, max 64) | `8` |

### `transactionRef`

A transaction reference like TXN-9Q4L... (not a payment credential).

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"TXN-"` |
| `length` | integer (min 4, max 64) | `12` |

### `url`

A URL on a reserved example domain (RFC 2606).

No options.

### `ipv4`

An IPv4 address from the RFC 5737 documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

No options.

### `ipv6`

An IPv6 address from the RFC 3849 documentation prefix 2001:db8::/32.

No options.

### `governmentId`

A clearly invalid government-identifier-shaped value (area 000, which is never issued). Never a real identifier.

No options.

### `cardNumber`

A 16-digit card-shaped value starting with 0000 and a deliberately failing Luhn check digit. Not usable for payments.

| Option | Type | Default |
|---|---|---|
| `separator` | `" "` \| `"-"` \| `""` | `" "` |

### `secret`

A placeholder for passwords, tokens and API keys. Clearly synthetic: dg_test_<hex>. Never a real credential.

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `"dg_test_"` |
| `length` | integer (min 8, max 64) | `24` |

## Numeric

### `integer`

An integer in [min, max] with a uniform, normal or exponential distribution.

| Option | Type | Default |
|---|---|---|
| `min` | number | `0` |
| `max` | number | `1000` |
| `distribution` | `"uniform"` \| `"normal"` \| `"exponential"` | `"uniform"` |
| `mean` | number |  |
| `stddev` | number |  |
| `lambda` | number |  |

### `decimal`

A decimal in [min, max] rounded to `precision` places.

| Option | Type | Default |
|---|---|---|
| `min` | number | `0` |
| `max` | number | `1000` |
| `distribution` | `"uniform"` \| `"normal"` \| `"exponential"` | `"uniform"` |
| `mean` | number |  |
| `stddev` | number |  |
| `lambda` | number |  |
| `precision` | integer (min 0, max 10) | `2` |

### `number`

A number in [min, max]. Integer output when both bounds are integers and no precision is set; otherwise decimal.

| Option | Type | Default |
|---|---|---|
| `min` | number | `0` |
| `max` | number | `100` |
| `distribution` | `"uniform"` \| `"normal"` \| `"exponential"` | `"uniform"` |
| `mean` | number |  |
| `stddev` | number |  |
| `lambda` | number |  |
| `precision` | integer (min 0, max 10) |  |

### `percentage`

A percentage between min and max (default 0-100).

| Option | Type | Default |
|---|---|---|
| `min` | number | `0` |
| `max` | number | `100` |
| `distribution` | `"uniform"` \| `"normal"` \| `"exponential"` | `"uniform"` |
| `mean` | number |  |
| `stddev` | number |  |
| `lambda` | number |  |
| `precision` | integer (min 0, max 6) | `1` |

### `currencyAmount`

A monetary amount with 2 decimals. With currency set, returns {amount, currency}.

| Option | Type | Default |
|---|---|---|
| `min` | number | `0` |
| `max` | number | `1000` |
| `distribution` | `"uniform"` \| `"normal"` \| `"exponential"` | `"uniform"` |
| `mean` | number |  |
| `stddev` | number |  |
| `lambda` | number |  |
| `currency` | string |  |

## Temporal

### `date`

A calendar date (YYYY-MM-DD) between from and to. Accepts ISO dates or offsets like "-5y", "+30d".

| Option | Type | Default |
|---|---|---|
| `from` | string \| number | `"-5y"` |
| `to` | string \| number | `"now"` |

### `timestamp`

A timestamp between from and to, as ISO 8601 (default), epoch milliseconds or epoch seconds.

| Option | Type | Default |
|---|---|---|
| `from` | string \| number | `"-5y"` |
| `to` | string \| number | `"now"` |
| `format` | `"iso"` \| `"epoch-ms"` \| `"epoch-s"` | `"iso"` |

### `pastDate`

A date within the last `years` years before the reference date.

| Option | Type | Default |
|---|---|---|
| `years` | number (max 200) | `5` |

### `futureDate`

A date within the next `years` years after the reference date.

| Option | Type | Default |
|---|---|---|
| `years` | number (max 200) | `2` |

### `dateRange`

An object {start, end} where end follows start by minDays..maxDays.

| Option | Type | Default |
|---|---|---|
| `from` | string \| number | `"-5y"` |
| `to` | string \| number | `"now"` |
| `minDays` | integer (min 0, max 9007199254740991) | `1` |
| `maxDays` | integer (min 0, max 9007199254740991) | `365` |

### `renewalDate`

A renewal date: an anniversary of a sibling start/joining date after the reference date, or within the next year.

| Option | Type | Default |
|---|---|---|
| `termMonths` | integer (min 1, max 120) | `12` |

### `expiryDate`

An expiry date; `expiredRatio` controls the share already expired relative to the reference date.

| Option | Type | Default |
|---|---|---|
| `expiredRatio` | number (min 0, max 1) | `0.1` |
| `maxYears` | number (max 50) | `3` |

## Text

### `string`

Neutral placeholder words with a length between minLength and maxLength.

| Option | Type | Default |
|---|---|---|
| `minLength` | integer (min 0, max 10000) | `5` |
| `maxLength` | integer (min 0, max 10000) | `24` |

### `sentence`

A sentence of neutral placeholder words.

| Option | Type | Default |
|---|---|---|
| `minWords` | integer (min 1, max 200) | `4` |
| `maxWords` | integer (min 1, max 200) | `12` |

## Custom

### `constant`

Always returns the configured value.

| Option | Type | Default |
|---|---|---|
| `value` | value |  |

### `enum`

One of `values`, optionally weighted.

| Option | Type | Default |
|---|---|---|
| `values` | array |  |
| `weights` | array |  |

### `boolean`

true with the given probability (default 0.5).

| Option | Type | Default |
|---|---|---|
| `probability` | number (min 0, max 1) | `0.5` |

### `sequence`

A sequential value: prefix + zero-padded (start + index * step). Unique within a collection.

| Option | Type | Default |
|---|---|---|
| `prefix` | string | `""` |
| `suffix` | string | `""` |
| `start` | integer (min -9007199254740991, max 9007199254740991) | `1` |
| `step` | integer (min 1, max 9007199254740991) | `1` |
| `pad` | integer (min 0, max 20) | `0` |

### `pattern`

A string matching a safe subset of regular-expression syntax (no backreferences or lookarounds).

| Option | Type | Default |
|---|---|---|
| `pattern` | string |  |

### `null`

Always null.

No options.
