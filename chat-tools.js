// Shared, local-only metadata. A calling code is a hint, never a location fix.
globalThis.WAChatTools = {
  regions: {
    CN: ['中国', 'CNY', ['Asia/Shanghai'], '86'],
    US: ['美国', 'USD', ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'], ''],
    CA: ['加拿大', 'CAD', ['America/Toronto', 'America/Vancouver', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns'], ''],
    GB: ['英国', 'GBP', ['Europe/London'], '44'],
    DE: ['德国', 'EUR', ['Europe/Berlin'], '49'],
    FR: ['法国', 'EUR', ['Europe/Paris'], '33'],
    ES: ['西班牙', 'EUR', ['Europe/Madrid', 'Atlantic/Canary'], '34'],
    IT: ['意大利', 'EUR', ['Europe/Rome'], '39'],
    PT: ['葡萄牙', 'EUR', ['Europe/Lisbon', 'Atlantic/Azores'], '351'],
    BR: ['巴西', 'BRL', ['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco'], '55'],
    MX: ['墨西哥', 'MXN', ['America/Mexico_City', 'America/Tijuana', 'America/Cancun'], '52'],
    AR: ['阿根廷', 'ARS', ['America/Argentina/Buenos_Aires'], '54'],
    CL: ['智利', 'CLP', ['America/Santiago', 'Pacific/Easter'], '56'],
    CO: ['哥伦比亚', 'COP', ['America/Bogota'], '57'],
    PE: ['秘鲁', 'PEN', ['America/Lima'], '51'],
    IN: ['印度', 'INR', ['Asia/Kolkata'], '91'],
    PK: ['巴基斯坦', 'PKR', ['Asia/Karachi'], '92'],
    BD: ['孟加拉国', 'BDT', ['Asia/Dhaka'], '880'],
    AE: ['阿联酋', 'AED', ['Asia/Dubai'], '971'],
    SA: ['沙特阿拉伯', 'SAR', ['Asia/Riyadh'], '966'],
    TR: ['土耳其', 'TRY', ['Europe/Istanbul'], '90'],
    EG: ['埃及', 'EGP', ['Africa/Cairo'], '20'],
    NG: ['尼日利亚', 'NGN', ['Africa/Lagos'], '234'],
    ZA: ['南非', 'ZAR', ['Africa/Johannesburg'], '27'],
    KE: ['肯尼亚', 'KES', ['Africa/Nairobi'], '254'],
    JP: ['日本', 'JPY', ['Asia/Tokyo'], '81'],
    KR: ['韩国', 'KRW', ['Asia/Seoul'], '82'],
    VN: ['越南', 'VND', ['Asia/Ho_Chi_Minh'], '84'],
    TH: ['泰国', 'THB', ['Asia/Bangkok'], '66'],
    ID: ['印度尼西亚', 'IDR', ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'], '62'],
    MY: ['马来西亚', 'MYR', ['Asia/Kuala_Lumpur'], '60'],
    SG: ['新加坡', 'SGD', ['Asia/Singapore'], '65'],
    PH: ['菲律宾', 'PHP', ['Asia/Manila'], '63'],
    AU: ['澳大利亚', 'AUD', ['Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Darwin'], '61'],
    NZ: ['新西兰', 'NZD', ['Pacific/Auckland', 'Pacific/Chatham'], '64'],
    RU: ['俄罗斯', 'RUB', ['Europe/Moscow', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Vladivostok'], ''],
    UA: ['乌克兰', 'UAH', ['Europe/Kyiv'], '380'],
    PL: ['波兰', 'PLN', ['Europe/Warsaw'], '48'],
    NL: ['荷兰', 'EUR', ['Europe/Amsterdam'], '31']
  },
  languageCodes: 'af sq am ar hy az eu be bn bs bg ca ceb co hr cs da nl en eo et fi fr fy gl ka de el gu ht ha haw he hi hmn hu is ig id ga it ja jv kn kk km rw ko ku ky lo la lv lt lb mk mg ms ml mt mi mr mn my ne no ny or ps fa pl pt pa ro ru sm gd sr st sn sd si sk sl so es su sw sv tl tg ta tt te th tr tk uk ur ug uz vi cy xh yi yo zu'.split(' '),
  defaultPhrases: [
    { title: '欢迎咨询', text: '您好，很高兴为您服务。请问您对哪款产品感兴趣？' },
    { title: '确认需求', text: '请告诉我您需要的数量、规格和收货地址，我会为您提供报价。' },
    { title: '发送报价', text: '感谢您的耐心等待，报价已准备好，请查收。如有疑问欢迎随时联系。' },
    { title: '跟进客户', text: '您好，想跟进一下您之前咨询的产品。您还有什么需要了解的吗？' }
  ],
  inferRegion(phone) {
    const digits = String(phone).replace(/\D/g, '');
    return Object.entries(this.regions)
      .filter(([, item]) => item[3] && digits.startsWith(item[3]))
      .sort((a, b) => b[1][3].length - a[1][3].length)[0]?.[0] || '';
  }
};
