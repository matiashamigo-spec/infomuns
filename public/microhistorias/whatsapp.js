export function buildWhatsAppLink(phone, message) {
  const digits = phone.replace(/[^0-9]/g, '');
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
