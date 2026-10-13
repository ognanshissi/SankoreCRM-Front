import { Component, computed, input, output, signal } from '@angular/core';
import qrcode from 'qrcode-generator';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';

/**
 * « Vous avez ouvert ce lien sur un ordinateur » (KRM-F-09).
 *
 * **Une proposition, jamais un barrage.** Le client peut toujours continuer avec la webcam : le
 * second critère de la story le demande, et c'est aussi la seule issue honnête puisque la
 * détection ci-dessous est une heuristique. Un écran qui refuserait de continuer sur une
 * mauvaise détection remplacerait une gêne — photographier une carte d'identité avec une webcam
 * — par un cul-de-sac.
 *
 * **Le QR encode le lien COMPLET, jeton compris.** C'est voulu et c'est ce qui rend l'écran utile
 * : scanner le code ouvre exactement la même page sur le téléphone, identification comprise. Deux
 * conséquences assumées :
 *
 * 1. Le jeton reparaît à l'écran, donc le QR ne s'affiche que sur cet écran-là et le composant ne
 *    l'écrit nulle part — ni dans l'URL (le parent l'a effacée avec `replaceState`), ni dans le
 *    `localStorage`, ni dans un journal.
 * 2. Le lien reste à usage unique côté serveur : scanner le code ne duplique rien, il déplace le
 *    parcours. Le navigateur de l'ordinateur garde une session qui échouera au prochain appel dès
 *    que le téléphone aura soumis — ce que `KycRemoteGate` vérifie à chaque requête.
 *
 * **Le QR est dessiné en SVG et non sur un canvas.** Un canvas doit être redessiné à chaque
 * changement de taille et ne s'imprime pas proprement ; un SVG est net à n'importe quelle taille,
 * ce qui compte pour un code qu'on scanne avec un téléphone tenu à vingt centimètres d'un écran.
 */
@Component({
  selector: 'kyc-continue-on-phone',
  imports: [TasIcon, Button],
  template: `
    <div class="flex flex-col items-center gap-4 text-center">
      <tas-icon iconName="feather:smartphone" class="text-primary" style="font-size:28px"></tas-icon>

      <div>
        <p class="text-base font-semibold text-slate-800">Continuez sur votre téléphone</p>
        <p class="text-sm text-slate-600 mt-1 max-w-sm">
          Cet appareil ne semble pas avoir d'appareil photo arrière. Scannez ce code avec votre
          téléphone pour reprendre la démarche là où vous en êtes.
        </p>
      </div>

      <!--
        innerHTML sur du SVG que ce composant vient de produire lui-même : la seule donnée
        variable est le lien, et qrcode-generator n'émet que des rectangles. Angular
        assainit quand même la chaîne, ce qui retirerait un script si l'un y arrivait.
      -->
      <div
        class="bg-white p-3 rounded-lg border border-slate-200"
        [innerHTML]="qrSvg()"
      ></div>

      <button tas-outlined-button color="primary" type="button" (click)="continueHere.emit()">
        <tas-icon iconName="feather:video" style="font-size:14px"></tas-icon>
        Continuer avec la webcam
      </button>

      <p class="text-xs text-slate-400 max-w-sm">
        Une photo prise avec une webcam est souvent moins lisible qu'une photo de téléphone : si
        elle est refusée, reprenez-la depuis votre téléphone.
      </p>
    </div>
  `,
})
export class KycContinueOnPhone {
  /** Le lien complet, fragment compris. Construit par le parent, qui seul détient le jeton. */
  public readonly link = input.required<string>();

  /** Le client choisit de rester sur cet appareil. */
  public readonly continueHere = output<void>();

  public readonly qrSvg = computed(() => buildQrSvg(this.link()));
}

/**
 * Le SVG du QR, en une chaîne.
 *
 * <p>
 * Niveau de correction **M** (≈15 % de redondance) et version automatique : le code est scanné
 * à l'écran, pas imprimé sur un carton froissé, donc la redondance supplémentaire de `Q` ou `H`
 * ne servirait qu'à rendre les modules plus petits — et un module plus petit est précisément ce
 * qui fait échouer un scan sur un écran.
 * </p>
 *
 * <p>
 * Le mode `Byte` est imposé par le contenu : un jeton base64url contient des minuscules, que le
 * mode alphanumérique du QR ne sait pas encoder. Le laisser deviner produirait une erreur
 * d'encodage sur le seul caractère qui compte.
 * </p>
 */
function buildQrSvg(link: string): string {
  // typeNumber 0 = « choisis la plus petite version qui contient la donnée ». Un lien de ce
  // parcours fait ~90 caractères, soit la version 5 ou 6 en niveau M.
  const qr = qrcode(0, 'M');
  qr.addData(link, 'Byte');
  qr.make();

  const count = qr.getModuleCount();

  // Le `viewBox` porte la grille et la largeur est en pourcentage : le SVG remplit son conteneur
  // sans que ce composant ait à choisir une taille en pixels, ce qui est ce qui garde le code net
  // aussi bien dans une carte de 200 px que plein écran sur un ordinateur portable.
  const cells: string[] = [];

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        cells.push(`<rect x="${col}" y="${row}" width="1" height="1"/>`);
      }
    }
  }

  // La marge silencieuse de 4 modules fait partie de la norme : sans elle, un scanner confond le
  // bord du code avec un module sombre et ne le trouve pas du tout.
  const quiet = 4;
  const size = count + quiet * 2;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="180" height="180" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Code QR du lien de dépôt des pièces">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<g transform="translate(${quiet},${quiet})" fill="#0f172a">${cells.join('')}</g>` +
    `</svg>`
  );
}
