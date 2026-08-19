import { describe, it, expect } from 'vitest';
import { buildWhatsAppLink } from '../../public/microhistorias/whatsapp.js';

describe('buildWhatsAppLink', () => {
  it('strips spaces and the plus sign from the phone number', () => {
    expect(buildWhatsAppLink('+54 9 291 6419599')).toBe('https://wa.me/5492916419599');
  });

  it('returns a plain link when no message is given', () => {
    expect(buildWhatsAppLink('+5492916419599')).toBe('https://wa.me/5492916419599');
  });

  it('appends a url-encoded text param when a message is given', () => {
    expect(buildWhatsAppLink('+5492916419599', 'Tengo una duda')).toBe(
      'https://wa.me/5492916419599?text=Tengo%20una%20duda'
    );
  });
});
