/*! Mar-Khoor phone boxes: a country-code picker and a local example in front of every phone
 *  input marked data-phone. The input keeps one plain value like "+92 300 1234567", so the
 *  server sees exactly what it did before. */
(() => {
  // [ISO, dial code, English name, mobile example]. Common countries first, then the rest A–Z.
  const C = [
    ['PK','92','Pakistan','300 1234567'], ['AE','971','United Arab Emirates','50 123 4567'], ['SA','966','Saudi Arabia','50 123 4567'],
    ['IN','91','India','98765 43210'], ['BD','880','Bangladesh','1812 345678'], ['GB','44','United Kingdom','7400 123456'],
    ['US','1','United States','201 555 0123'], ['CA','1','Canada','506 234 5678'], ['AU','61','Australia','412 345 678'],
    ['QA','974','Qatar','3312 3456'], ['KW','965','Kuwait','500 12345'], ['OM','968','Oman','9212 3456'], ['BH','973','Bahrain','3600 1234'],
    ['TR','90','Türkiye','501 234 56 78'], ['AF','93','Afghanistan','70 123 4567'], ['IR','98','Iran','912 345 6789'],
    ['IQ','964','Iraq','791 234 5678'], ['JO','962','Jordan','7 9012 3456'], ['EG','20','Egypt','100 123 4567'], ['MA','212','Morocco','650 123456'],
    ['LK','94','Sri Lanka','71 234 5678'], ['NP','977','Nepal','984 1234567'], ['MY','60','Malaysia','12 345 6789'], ['ID','62','Indonesia','812 345 678'],
    ['SG','65','Singapore','8123 4567'], ['CN','86','China','131 2345 6789'], ['DE','49','Germany','1512 3456789'], ['FR','33','France','6 12 34 56 78'],
    ['IT','39','Italy','312 345 6789'], ['ES','34','Spain','612 34 56 78'], ['NL','31','Netherlands','6 12345678'], ['IE','353','Ireland','85 012 3456'],
    ['SE','46','Sweden','70 123 45 67'], ['NO','47','Norway','406 12 345'], ['PT','351','Portugal','912 345 678'], ['RU','7','Russia','912 345 67 89'],
    ['NG','234','Nigeria','802 123 4567'], ['ZA','27','South Africa','71 123 4567'], ['KE','254','Kenya','712 123456'], ['NZ','64','New Zealand','21 123 4567'],
    // Every other country, A–Z (no local example).
    ['AL','355','Albania',''], ['DZ','213','Algeria',''], ['AD','376','Andorra',''], ['AO','244','Angola',''],
    ['AG','1268','Antigua and Barbuda',''], ['AR','54','Argentina',''], ['AM','374','Armenia',''], ['AW','297','Aruba',''],
    ['AT','43','Austria',''], ['AZ','994','Azerbaijan',''], ['BS','1242','Bahamas',''], ['BB','1246','Barbados',''],
    ['BY','375','Belarus',''], ['BE','32','Belgium',''], ['BZ','501','Belize',''], ['BJ','229','Benin',''],
    ['BM','1441','Bermuda',''], ['BT','975','Bhutan',''], ['BO','591','Bolivia',''], ['BA','387','Bosnia and Herzegovina',''],
    ['BW','267','Botswana',''], ['BR','55','Brazil',''], ['BN','673','Brunei',''], ['BG','359','Bulgaria',''],
    ['BF','226','Burkina Faso',''], ['BI','257','Burundi',''], ['KH','855','Cambodia',''], ['CM','237','Cameroon',''],
    ['CV','238','Cape Verde',''], ['KY','1345','Cayman Islands',''], ['CF','236','Central African Republic',''], ['TD','235','Chad',''],
    ['CL','56','Chile',''], ['CO','57','Colombia',''], ['KM','269','Comoros',''], ['CG','242','Congo',''],
    ['CD','243','Congo (DRC)',''], ['CR','506','Costa Rica',''], ['HR','385','Croatia',''], ['CU','53','Cuba',''],
    ['CW','599','Curaçao',''], ['CY','357','Cyprus',''], ['CZ','420','Czechia',''], ['CI','225',"Côte d'Ivoire",''],
    ['DK','45','Denmark',''], ['DJ','253','Djibouti',''], ['DM','1767','Dominica',''], ['DO','1809','Dominican Republic',''],
    ['EC','593','Ecuador',''], ['SV','503','El Salvador',''], ['GQ','240','Equatorial Guinea',''], ['ER','291','Eritrea',''],
    ['EE','372','Estonia',''], ['SZ','268','Eswatini',''], ['ET','251','Ethiopia',''], ['FJ','679','Fiji',''],
    ['FI','358','Finland',''], ['GA','241','Gabon',''], ['GM','220','Gambia',''], ['GE','995','Georgia',''],
    ['GH','233','Ghana',''], ['GI','350','Gibraltar',''], ['GR','30','Greece',''], ['GD','1473','Grenada',''],
    ['GU','1671','Guam',''], ['GT','502','Guatemala',''], ['GN','224','Guinea',''], ['GW','245','Guinea-Bissau',''],
    ['GY','592','Guyana',''], ['HT','509','Haiti',''], ['HN','504','Honduras',''], ['HK','852','Hong Kong',''],
    ['HU','36','Hungary',''], ['IS','354','Iceland',''], ['IL','972','Israel',''], ['JM','1876','Jamaica',''],
    ['JP','81','Japan',''], ['KZ','7','Kazakhstan',''], ['XK','383','Kosovo',''], ['KG','996','Kyrgyzstan',''],
    ['LA','856','Laos',''], ['LV','371','Latvia',''], ['LB','961','Lebanon',''], ['LS','266','Lesotho',''],
    ['LR','231','Liberia',''], ['LY','218','Libya',''], ['LI','423','Liechtenstein',''], ['LT','370','Lithuania',''],
    ['LU','352','Luxembourg',''], ['MO','853','Macao',''], ['MG','261','Madagascar',''], ['MW','265','Malawi',''],
    ['MV','960','Maldives',''], ['ML','223','Mali',''], ['MT','356','Malta',''], ['MR','222','Mauritania',''],
    ['MU','230','Mauritius',''], ['MX','52','Mexico',''], ['MD','373','Moldova',''], ['MC','377','Monaco',''],
    ['MN','976','Mongolia',''], ['ME','382','Montenegro',''], ['MZ','258','Mozambique',''], ['MM','95','Myanmar',''],
    ['NA','264','Namibia',''], ['NI','505','Nicaragua',''], ['NE','227','Niger',''], ['MK','389','North Macedonia',''],
    ['PS','970','Palestine',''], ['PA','507','Panama',''], ['PG','675','Papua New Guinea',''], ['PY','595','Paraguay',''],
    ['PE','51','Peru',''], ['PH','63','Philippines',''], ['PL','48','Poland',''], ['PR','1787','Puerto Rico',''],
    ['RO','40','Romania',''], ['RW','250','Rwanda',''], ['KN','1869','Saint Kitts and Nevis',''], ['LC','1758','Saint Lucia',''],
    ['VC','1784','Saint Vincent and the Grenadines',''], ['WS','685','Samoa',''], ['SM','378','San Marino',''], ['SN','221','Senegal',''],
    ['RS','381','Serbia',''], ['SC','248','Seychelles',''], ['SL','232','Sierra Leone',''], ['SK','421','Slovakia',''],
    ['SI','386','Slovenia',''], ['SB','677','Solomon Islands',''], ['SO','252','Somalia',''], ['KR','82','South Korea',''],
    ['SS','211','South Sudan',''], ['SD','249','Sudan',''], ['SR','597','Suriname',''], ['CH','41','Switzerland',''],
    ['SY','963','Syria',''], ['TW','886','Taiwan',''], ['TJ','992','Tajikistan',''], ['TZ','255','Tanzania',''],
    ['TH','66','Thailand',''], ['TL','670','Timor-Leste',''], ['TG','228','Togo',''], ['TO','676','Tonga',''],
    ['TT','1868','Trinidad and Tobago',''], ['TN','216','Tunisia',''], ['TM','993','Turkmenistan',''], ['TC','1649','Turks and Caicos Islands',''],
    ['UG','256','Uganda',''], ['UA','380','Ukraine',''], ['UY','598','Uruguay',''], ['UZ','998','Uzbekistan',''],
    ['VU','678','Vanuatu',''], ['VE','58','Venezuela',''], ['VN','84','Vietnam',''], ['YE','967','Yemen',''],
    ['ZM','260','Zambia',''], ['ZW','263','Zimbabwe',''],
  ];
  const BY = Object.fromEntries(C.map(c => [c[0], c]));
  const ZONES = { 'Asia/Karachi':'PK', 'Asia/Dubai':'AE', 'Asia/Riyadh':'SA', 'Asia/Kolkata':'IN', 'Asia/Calcutta':'IN', 'Asia/Dhaka':'BD', 'Europe/London':'GB',
    'Asia/Qatar':'QA', 'Asia/Kuwait':'KW', 'Asia/Muscat':'OM', 'Asia/Bahrain':'BH', 'Europe/Istanbul':'TR', 'Asia/Kabul':'AF', 'Asia/Tehran':'IR',
    'Asia/Baghdad':'IQ', 'Asia/Amman':'JO', 'Africa/Cairo':'EG', 'Africa/Casablanca':'MA', 'Asia/Colombo':'LK', 'Asia/Kathmandu':'NP',
    'Asia/Kuala_Lumpur':'MY', 'Asia/Jakarta':'ID', 'Asia/Singapore':'SG', 'Asia/Shanghai':'CN', 'Europe/Berlin':'DE', 'Europe/Paris':'FR',
    'Europe/Rome':'IT', 'Europe/Madrid':'ES', 'Europe/Amsterdam':'NL', 'Europe/Dublin':'IE', 'Europe/Stockholm':'SE', 'Europe/Oslo':'NO',
    'Europe/Lisbon':'PT', 'Europe/Moscow':'RU', 'Africa/Lagos':'NG', 'Africa/Johannesburg':'ZA', 'Africa/Nairobi':'KE', 'Pacific/Auckland':'NZ',
    'Australia/Sydney':'AU', 'Australia/Melbourne':'AU', 'America/Toronto':'CA', 'America/Vancouver':'CA' };
  const KEY = 'mk-country';
  const flag = iso => String.fromCodePoint(...[...iso].map(ch => 0x1F1A5 + ch.charCodeAt(0)));

  function guessCountry() {
    try { const saved = localStorage.getItem(KEY); if (BY[saved]) return saved; } catch {}
    try { const zone = Intl.DateTimeFormat().resolvedOptions().timeZone; if (ZONES[zone]) return ZONES[zone]; if (/^America\//.test(zone)) return 'US'; } catch {}
    for (const tag of navigator.languages || [navigator.language || '']) { const region = String(tag).split('-')[1]?.toUpperCase(); if (BY[region]) return region; }
    return 'PK';
  }
  let fallback = guessCountry();
  const fields = new Set();

  // Longest dial code that the number starts with (+1 is shared by US/CA: keep the chosen one).
  function countryOf(value, current) {
    const digits = String(value || '').replace(/[^\d+]/g, '').replace(/^00/, '+');
    if (!digits.startsWith('+')) return null;
    const body = digits.slice(1);
    if (current && body.startsWith(BY[current][1])) return current;
    let best = null;
    for (const c of C) if (body.startsWith(c[1]) && (!best || c[1].length > best[1].length)) best = c;
    return best && best[0];
  }

  function enhance(input) {
    if (input.dataset.phoneReady) return;
    input.dataset.phoneReady = '1';
    const wrap = document.createElement('div');
    wrap.className = 'phone-field';
    wrap.style.cssText = 'display:flex;gap:6px;align-items:stretch;width:100%';
    const select = document.createElement('select');
    select.className = input.className || 'input';
    select.setAttribute('translate', 'no');
    select.setAttribute('aria-label', 'Country code');
    select.style.cssText = 'flex:0 0 auto;width:auto;max-width:7.5rem;padding-inline:8px';
    for (const [iso, dial, name] of C) { const o = document.createElement('option'); o.value = iso; o.textContent = flag(iso) + ' +' + dial + '  ' + name; select.append(o); }
    input.parentNode.insertBefore(wrap, input);
    wrap.append(select, input);
    input.style.flex = '1 1 auto'; input.style.minWidth = '0';
    const field = { input, select, touched: false };
    fields.add(field);
    let current = null;
    const show = iso => {
      current = iso; select.value = iso;
      // Collapsed select shows only flag and code; the open list shows names too.
      for (const o of select.options) o.textContent = flag(o.value) + ' +' + BY[o.value][1] + (o.value === iso ? '' : '  ' + BY[o.value][2]);
      const example = BY[iso][3] || 'phone number';
      if (!/^Using /.test(input.placeholder)) input.placeholder = '+' + BY[iso][1] + ' ' + example;
      input.title = 'Example: +' + BY[iso][1] + ' ' + example;
    };
    field.show = show;
    field.sync = () => show(countryOf(input.value, select.value) || select.value);
    show(input.dataset.phoneCountry && BY[input.dataset.phoneCountry] ? input.dataset.phoneCountry : fallback);
    field.sync();
    select.addEventListener('change', () => {
      const old = '+' + BY[current || select.value][1];
      const iso = select.value; field.touched = true;
      const value = input.value.trim();
      if (value.startsWith(old)) input.value = '+' + BY[iso][1] + ' ' + value.slice(old.length).trim();
      else if (!value) input.value = '+' + BY[iso][1] + ' ';
      show(iso);
      try { localStorage.setItem(KEY, iso); } catch {}
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('focus', () => { field.sync(); if (!input.value.trim()) input.value = '+' + BY[select.value][1] + ' '; });
    input.addEventListener('input', () => { field.touched = true; field.sync(); });
    input.addEventListener('blur', () => {
      let value = input.value.trim();
      const code = '+' + BY[select.value][1];
      if (value === code || value === '+') { input.value = ''; return; }
      // "+92 0300…" or "0300…" typed locally: drop the trunk 0 and add the code.
      if (value.startsWith(code)) value = code + ' ' + value.slice(code.length).trim().replace(/^0+/, '');
      else if (/^0[1-9]/.test(value)) value = code + ' ' + value.replace(/^0+/, '');
      // A local number typed without the code (e.g. Greek "694 363 6836" has no trunk 0): add the chosen code.
      else if (/^[1-9][\d\s().-]{5,}$/.test(value)) value = code + ' ' + value;
      input.value = value;
    });
  }

  function scan(root = document) { for (const input of root.querySelectorAll('input[data-phone]')) enhance(input); }
  window.mkPhone = {
    scan,
    sync() { for (const f of fields) if (f.input.isConnected) f.sync(); },
    // The dashboard knows the restaurant's country: use it for boxes the owner has not touched.
    setDefaultCountry(iso) {
      iso = String(iso || '').toUpperCase(); if (!BY[iso]) return;
      fallback = iso;
      for (const f of fields) if (!f.touched && !countryOf(f.input.value)) f.show(iso);
    },
    countryOf,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan()); else scan();
})();
