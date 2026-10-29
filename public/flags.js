// Country flags for admin-entered matches. Codes are ISO 3166-1 alpha-2 (plus UK nations),
// served as images by flagcdn.com.
window.FLAG_URL = (code, w = 80) => (code ? `https://flagcdn.com/w${w}/${code}.png` : '');
window.FLAGS = (
  'af:Afghanistan|al:Albania|dz:Algeria|ad:Andorra|ao:Angola|ag:Antigua and Barbuda|ar:Argentina|am:Armenia|au:Australia|' +
  'at:Austria|az:Azerbaijan|bs:Bahamas|bh:Bahrain|bd:Bangladesh|bb:Barbados|by:Belarus|be:Belgium|bz:Belize|bj:Benin|' +
  'bt:Bhutan|bo:Bolivia|ba:Bosnia and Herzegovina|bw:Botswana|br:Brazil|bn:Brunei|bg:Bulgaria|bf:Burkina Faso|bi:Burundi|' +
  'cv:Cape Verde|kh:Cambodia|cm:Cameroon|ca:Canada|cf:Central African Republic|td:Chad|cl:Chile|cn:China|co:Colombia|' +
  'km:Comoros|cg:Congo|cd:DR Congo|cr:Costa Rica|ci:Ivory Coast|hr:Croatia|cu:Cuba|cy:Cyprus|cz:Czechia|dk:Denmark|' +
  'dj:Djibouti|dm:Dominica|do:Dominican Republic|ec:Ecuador|eg:Egypt|sv:El Salvador|gb-eng:England|gq:Equatorial Guinea|' +
  'er:Eritrea|ee:Estonia|sz:Eswatini|et:Ethiopia|eu:European Union|fo:Faroe Islands|fj:Fiji|fi:Finland|fr:France|ga:Gabon|' +
  'gm:Gambia|ge:Georgia|de:Germany|gh:Ghana|gr:Greece|gd:Grenada|gt:Guatemala|gn:Guinea|gw:Guinea-Bissau|gy:Guyana|ht:Haiti|' +
  'hn:Honduras|hk:Hong Kong|hu:Hungary|is:Iceland|in:India|id:Indonesia|ir:Iran|iq:Iraq|ie:Ireland|il:Israel|it:Italy|' +
  'jm:Jamaica|jp:Japan|jo:Jordan|kz:Kazakhstan|ke:Kenya|xk:Kosovo|kw:Kuwait|kg:Kyrgyzstan|la:Laos|lv:Latvia|lb:Lebanon|' +
  'ls:Lesotho|lr:Liberia|ly:Libya|li:Liechtenstein|lt:Lithuania|lu:Luxembourg|mg:Madagascar|mw:Malawi|my:Malaysia|' +
  'mv:Maldives|ml:Mali|mt:Malta|mr:Mauritania|mu:Mauritius|mx:Mexico|md:Moldova|mc:Monaco|mn:Mongolia|me:Montenegro|' +
  'ma:Morocco|mz:Mozambique|mm:Myanmar|na:Namibia|np:Nepal|nl:Netherlands|nz:New Zealand|ni:Nicaragua|ne:Niger|ng:Nigeria|' +
  'kp:North Korea|mk:North Macedonia|gb-nir:Northern Ireland|no:Norway|om:Oman|pk:Pakistan|ps:Palestine|pa:Panama|' +
  'pg:Papua New Guinea|py:Paraguay|pe:Peru|ph:Philippines|pl:Poland|pt:Portugal|pr:Puerto Rico|qa:Qatar|ro:Romania|' +
  'ru:Russia|rw:Rwanda|kn:Saint Kitts and Nevis|lc:Saint Lucia|vc:Saint Vincent|ws:Samoa|sm:San Marino|st:Sao Tome and Principe|' +
  'sa:Saudi Arabia|gb-sct:Scotland|sn:Senegal|rs:Serbia|sc:Seychelles|sl:Sierra Leone|sg:Singapore|sk:Slovakia|si:Slovenia|' +
  'sb:Solomon Islands|so:Somalia|za:South Africa|kr:South Korea|ss:South Sudan|es:Spain|lk:Sri Lanka|sd:Sudan|sr:Suriname|' +
  'se:Sweden|ch:Switzerland|sy:Syria|tw:Taiwan|tj:Tajikistan|tz:Tanzania|th:Thailand|tl:Timor-Leste|tg:Togo|to:Tonga|' +
  'tt:Trinidad and Tobago|tn:Tunisia|tr:Turkey|tm:Turkmenistan|ug:Uganda|ua:Ukraine|ae:United Arab Emirates|' +
  'gb:United Kingdom|us:United States|uy:Uruguay|uz:Uzbekistan|vu:Vanuatu|ve:Venezuela|vn:Vietnam|gb-wls:Wales|' +
  'ye:Yemen|zm:Zambia|zw:Zimbabwe'
).split('|').map((p) => p.split(':'));
