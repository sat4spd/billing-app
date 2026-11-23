// Maps database exception codes (raised in PL/pgSQL) to friendly bilingual messages.

const MESSAGES: Record<string, { hi: string; en: string }> = {
  NOT_AUTHENTICATED: { hi: 'कृपया दोबारा लॉगिन करें', en: 'Please sign in again' },
  PERMISSION_DENIED: { hi: 'आपको यह कार्य करने की अनुमति नहीं है', en: 'You are not permitted to do this' },
  EMPTY_CART: { hi: 'बिल में कोई सामान नहीं है', en: 'Cart is empty' },
  PRODUCT_NOT_FOUND: { hi: 'उत्पाद नहीं मिला', en: 'Product not found' },
  PRODUCT_INACTIVE: { hi: 'यह उत्पाद निष्क्रिय है', en: 'Product is inactive' },
  INVALID_QUANTITY: { hi: 'मात्रा सही नहीं है', en: 'Invalid quantity' },
  INVALID_RATE: { hi: 'दर सही नहीं है', en: 'Invalid rate' },
  PRICE_EDIT_NOT_ALLOWED: { hi: 'दर बदलने की अनुमति नहीं है', en: 'Not allowed to change price' },
  DISCOUNT_NOT_ALLOWED: { hi: 'छूट देने की अनुमति नहीं है', en: 'Not allowed to give discount' },
  DISCOUNT_LIMIT: { hi: 'छूट अधिकतम सीमा से अधिक है', en: 'Discount exceeds the allowed limit' },
  DISCOUNT_EXCEEDS_AMOUNT: { hi: 'छूट राशि से अधिक है', en: 'Discount exceeds amount' },
  INVALID_BILL_DISCOUNT: { hi: 'बिल छूट सही नहीं है', en: 'Invalid bill discount' },
  INSUFFICIENT_STOCK: { hi: 'स्टॉक पर्याप्त नहीं है', en: 'Insufficient stock' },
  OVERPAYMENT: { hi: 'भुगतान कुल राशि से अधिक है', en: 'Payment exceeds total' },
  INVALID_PAYMENT_MODE: { hi: 'भुगतान का तरीका सही नहीं है', en: 'Invalid payment mode' },
  INVALID_PAYMENT_AMOUNT: { hi: 'भुगतान राशि सही नहीं है', en: 'Invalid payment amount' },
  INVALID_MOBILE: { hi: 'मोबाइल नंबर सही नहीं है (10 अंक)', en: 'Invalid mobile number' },
  CUSTOMER_REQUIRED_FOR_CREDIT: { hi: 'उधार / आंशिक भुगतान के लिए ग्राहक का नाम या मोबाइल आवश्यक है', en: 'Customer name/mobile is required for credit sales' },
  INVALID_ALLOCATION: { hi: 'भुगतान का बंटवारा सही नहीं है', en: 'Invalid payment allocation' },
  ALLOCATION_MISMATCH: { hi: 'बंटवारे का योग भुगतान के बराबर होना चाहिए', en: 'Allocation must equal the amount paid' },
  REASON_REQUIRED: { hi: 'कारण लिखना आवश्यक है', en: 'Reason is required' },
  ALREADY_REVERSED: { hi: 'बिल पहले ही रद्द/वापस हो चुका है', en: 'Bill already cancelled/returned' },
  CANCELLATION_PENDING: { hi: 'इस बिल का रद्दीकरण अनुरोध पहले से लंबित है', en: 'A cancellation request is already pending' },
  RETURN_PENDING: { hi: 'पहले लंबित वापसी अनुरोध निपटाएं', en: 'Resolve pending return requests first' },
  RETURN_QTY_EXCEEDS: { hi: 'वापसी मात्रा बेची गई मात्रा से अधिक है', en: 'Return quantity exceeds sold quantity' },
  NO_ITEMS_TO_RETURN: { hi: 'वापसी के लिए कोई सामान नहीं चुना गया', en: 'No items selected for return' },
  ALREADY_DECIDED: { hi: 'इस अनुरोध पर पहले ही निर्णय हो चुका है', en: 'Request already decided' },
  CATEGORY_IN_USE: { hi: 'इस श्रेणी में उत्पाद/बिल मौजूद हैं — इसे निष्क्रिय करें', en: 'Category has products/bills — deactivate instead' },
  NAME_REQUIRED: { hi: 'हिंदी नाम आवश्यक है', en: 'Hindi name is required' },
  INVALID_PRICE: { hi: 'मूल्य सही नहीं है', en: 'Invalid price' },
  DELETE_NOT_ALLOWED: { hi: 'पूर्ण बिक्री रिकॉर्ड मिटाए नहीं जा सकते', en: 'Completed records cannot be deleted' },
  LAST_ADMIN: { hi: 'कम से कम एक सक्रिय प्रशासक आवश्यक है', en: 'At least one active administrator is required' },
  IDEMPOTENCY_KEY_REQUIRED: { hi: 'आंतरिक त्रुटि (कुंजी)', en: 'Internal error (idempotency key)' },
};

export function errorMessage(err: unknown, lang: 'hi' | 'en' = 'hi'): string {
  if (!err) return '';
  const raw =
    typeof err === 'string' ? err :
    (err as { message?: string }).message || (err as { error_description?: string }).error_description || JSON.stringify(err);

  if (/Failed to fetch|NetworkError|network/i.test(raw)) {
    return lang === 'hi' ? 'इंटरनेट कनेक्शन नहीं है। कृपया कनेक्शन जांच कर दोबारा प्रयास करें।' : 'No internet connection. Please retry.';
  }
  if (/duplicate key.*barcode/i.test(raw)) return lang === 'hi' ? 'यह बारकोड पहले से किसी अन्य उत्पाद में है' : 'Barcode already used by another product';
  if (/duplicate key.*product_code/i.test(raw)) return lang === 'hi' ? 'यह उत्पाद कोड पहले से मौजूद है' : 'Product code already exists';
  if (/duplicate key.*code/i.test(raw)) return lang === 'hi' ? 'यह कोड पहले से मौजूद है' : 'Code already exists';
  if (/Invalid login credentials/i.test(raw)) return lang === 'hi' ? 'ईमेल या पासवर्ड गलत है' : 'Invalid email or password';

  const m = raw.match(/^([A-Z_]{4,})(?::\s*(.*))?$/s);
  if (m && MESSAGES[m[1]]) {
    const base = MESSAGES[m[1]][lang];
    const detail = m[2]?.trim();
    return detail && !base.includes(detail) ? `${base}: ${detail}` : base;
  }
  return raw;
}
