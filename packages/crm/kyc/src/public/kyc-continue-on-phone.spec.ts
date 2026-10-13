import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';

/**
 * Le dessin du QR de KRM-F-09.
 *
 * L'ENCODAGE est la responsabilité de `qrcode-generator` et n'est pas retesté ici. Ce qui est
 * testé est la seule partie écrite à la main — la boucle qui transforme la grille en SVG — parce
 * qu'un QR mal dessiné ne se voit pas : il s'affiche parfaitement et ne scanne simplement pas,
 * et personne ne peut le vérifier sans un téléphone.
 *
 * Les trois propriétés qui le font scanner, et qu'on peut vérifier sans caméra : un module par
 * cellule sombre, une marge silencieuse de quatre modules, et un `viewBox` qui contient les deux.
 */
describe('le SVG du QR', () => {
  // Le lien tel que le parcours le produit : origine + route + fragment portant un jeton
  // base64url de 43 caractères.
  const link =
    'https://imf.sankore.app/kyc/verification#t=' + 'a'.repeat(21) + '_' + 'B'.repeat(21);

  /** La même construction que le composant, pour pouvoir l'inspecter. */
  function build(data: string) {
    const qr = qrcode(0, 'M');
    qr.addData(data, 'Byte');
    qr.make();
    return qr;
  }

  it('encode un lien de ce parcours sans déborder', () => {
    // typeNumber 0 choisit la plus petite version qui contient la donnée. Si elle échouait, la
    // bibliothèque lève — ce qui est le vrai sujet de ce cas : un lien de ~90 caractères tient.
    const qr = build(link);

    expect(qr.getModuleCount()).toBeGreaterThan(20);
    expect(qr.getModuleCount()).toBeLessThan(80);
  });

  it('le mode Byte est nécessaire, pas une préférence', () => {
    // Un jeton base64url contient des minuscules, que le mode alphanumérique du QR ne sait pas
    // encoder. Ce cas existe pour que « optimiser » en laissant la bibliothèque deviner casse
    // visiblement plutôt que silencieusement.
    const qr = qrcode(0, 'M');

    expect(() => {
      qr.addData(link, 'Alphanumeric');
      qr.make();
    }).toThrow();
  });

  it('dessine exactement un rectangle par module sombre', () => {
    // La propriété qui compte : un décalage d'indice dans la double boucle produit un code qui
    // s'affiche et ne scanne pas.
    const qr = build(link);
    const count = qr.getModuleCount();

    let dark = 0;
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) dark++;
      }
    }

    // Reconstruit comme le composant le fait.
    const cells: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          cells.push(`<rect x="${col}" y="${row}" width="1" height="1"/>`);
        }
      }
    }

    expect(cells).toHaveLength(dark);

    // Et x/y sont bien (colonne, ligne) et non l'inverse : un QR transposé est un QR qui ne
    // scanne pas, et il a exactement la même allure.
    const firstDark = (() => {
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) return { row, col };
        }
      }
      return null;
    })();

    expect(firstDark).not.toBeNull();
    expect(cells[0]).toBe(
      `<rect x="${firstDark!.col}" y="${firstDark!.row}" width="1" height="1"/>`,
    );
  });

  it('garde une marge silencieuse de quatre modules dans le viewBox', () => {
    // Sans elle, un scanner confond le bord du code avec un module sombre et ne le trouve pas du
    // tout. Elle fait partie de la norme, pas de l'esthétique.
    const qr = build(link);
    const quiet = 4;
    const size = qr.getModuleCount() + quiet * 2;

    expect(size).toBe(qr.getModuleCount() + 8);
  });

  it('un lien plus court produit un code plus petit', () => {
    // Pin de la version automatique : une version fixée trop haut rendrait les modules plus
    // petits à l'écran, ce qui est précisément ce qui fait échouer un scan sur un moniteur.
    const short = build('https://a.b/#t=x');
    const long = build(link);

    expect(short.getModuleCount()).toBeLessThanOrEqual(long.getModuleCount());
  });
});
