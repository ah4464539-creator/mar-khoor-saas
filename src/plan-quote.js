const features = {
  website: 'Website Builder',
  webAi: 'Web AI Assistant',
  whatsapp: 'WhatsApp Business',
  voice: 'AI Call Assistant'
};

function readCatalog(raw) {
  try {
    return JSON.parse(raw || '{}') || {};
  } catch {
    return {};
  }
}

const validPrice = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;

export function quotePlan(selection, catalog = readCatalog(process.env.PLAN_CATALOG_JSON)) {
  const { country, features: selected, numberMode = 'existing' } = selection ?? {};
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)
      || !Array.isArray(selected) || selected.length > 4
      || selected.some(key => typeof key !== 'string' || !Object.hasOwn(features, key))
      || !['existing', 'new'].includes(numberMode)) {
    throw new TypeError('Select a country and valid services.');
  }

  const items = [...new Set(selected)].map(key => {
    const price = catalog.services?.[key];
    return {
      label: features[key],
      status: validPrice(price) ? 'quoted' : 'pricing pending',
      monthly: validPrice(price) ? price : null,
      setup: 0
    };
  });

  if (selected.includes('voice') && numberMode === 'new') {
    const number = catalog.numbers?.[country];
    const setup = number?.setup ?? 0;
    const status = number?.status === 'unavailable' ? 'unavailable'
      : validPrice(number?.monthly) && validPrice(setup) ? 'verification pending'
      : 'availability pending';
    items.push({
      label: 'Local phone number (' + country + ')',
      status,
      monthly: status === 'verification pending' ? number.monthly : null,
      setup: status === 'verification pending' ? setup : null
    });
  }

  const quoted = items.filter(item => item.status === 'quoted');
  const monthly = quoted.reduce((total, item) => total + item.monthly, 0);
  return {
    currency: 'USD',
    items,
    monthly,
    firstMonth: monthly,
    complete: items.length > 0 && items.every(item => item.status === 'quoted'),
    usage: {
      voiceMinutes: validPrice(catalog.voiceMinutes) ? catalog.voiceMinutes : null,
      voiceExtra: validPrice(catalog.voiceExtra) ? catalog.voiceExtra : null
    }
  };
}
