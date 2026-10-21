/**
 * Bip court à deux tons pour une nouvelle notification de la cloche (WA-FE-10).
 *
 * Généré par Web Audio plutôt que lu depuis un fichier : aucun actif à servir ni à mettre en
 * cache, et rien qui casse si le chemin de déploiement change.
 *
 * Ne lève JAMAIS. La politique d'autoplay des navigateurs bloque le son tant que l'utilisateur
 * n'a pas interagi avec la page : le contexte reste alors `suspended` et `resume()` rejette ou
 * ne fait rien. Un son manqué ne doit pas empêcher le reste du traitement de la notification
 * (toast, rechargement de la liste), d'où le `try` large et les promesses avalées.
 */
let audioContext: AudioContext | null = null;

export function playNotificationSound(): void {
  try {
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    // Un seul contexte pour la session : Chrome en limite le nombre, et en recréer un par
    // notification finit par échouer.
    audioContext ??= new Ctor();
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const start = ctx.currentTime + 0.01;
    tone(ctx, 880, start, 0.12);
    tone(ctx, 1320, start + 0.15, 0.16);
  } catch {
    /* audio indisponible ou bloqué : la notification reste visible, c'est l'essentiel */
  }
}

function tone(ctx: AudioContext, frequency: number, at: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, at);
  // Attaque et extinction rapides : un créneau brut produit un « clic » audible.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.12, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}
