/**
 * ASPE - Libre-service amicalistes :
 *   1) récupération du numéro d'adhérent FNSPF
 *   2) collecte / mise à jour de l'adresse email
 * Projet Apps Script autonome relié au Google Sheet défini par ID_CLASSEUR.
 * La page publique (index.html) est hébergée sur GitHub Pages et interroge ce script.
 *
 * Onglet requis : "Adherents" avec en ligne 1 au minimum les en-têtes :
 *   Nom | Prénom | Date de naissance | N° FNSPF
 * Les colonnes "Email" et "Consentement email" sont créées automatiquement si absentes.
 * L'onglet "Journal" est créé automatiquement.
 */

// ===================== RÉGLAGES =====================
const ID_CLASSEUR = '17q2L17MeRga3kjl3Q1_8HYu4fKC8tsEM5sRuErN3m5g'; // Google Sheet de la base
function classeur() { return SpreadsheetApp.openById(ID_CLASSEUR); }

const CONFIG = {
  ONGLET_BASE: 'Adherents',
  ONGLET_JOURNAL: 'Journal',
  COL_NOM: 'Nom',
  COL_PRENOM: 'Prénom',
  COL_NAISSANCE: 'Date de naissance',
  COL_NUMERO: 'N° FNSPF',
  COL_EMAIL: 'Email',
  COL_CONSENTEMENT: 'Consentement email',
  CONTACT: 'le bureau de l\'amicale',      // texte affiché en cas d'échec (ex. "aspe.evreux@gmail.com")
  MAX_ESSAIS: 5,                           // essais ratés autorisés par nom + prénom
  BLOCAGE_MINUTES: 60                      // durée du blocage après trop d'essais
};
// ====================================================

/**
 * API appelée par la page publique (GitHub Pages).
 *   ?action=rechercher&nom=...&prenom=...&date=AAAA-MM-JJ
 *   ?action=email&nom=...&prenom=...&date=...&email=...&accord=1
 * Réponse : JSON.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  var res;
  if (p.action === 'rechercher') {
    res = rechercherNumero(p.nom, p.prenom, p.date);
  } else if (p.action === 'email') {
    res = enregistrerEmail(p.nom, p.prenom, p.date, p.email, p.accord === '1');
  } else {
    res = { ok: true, message: 'API ASPE opérationnelle.' };
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Recherche de l'amicaliste. Retourne :
 * { ok, identifie, message, numero?, emailMasque? }
 */
function rechercherNumero(nom, prenom, dateNaissance) {
  const saisie = controlerSaisie(nom, prenom, dateNaissance);
  if (!saisie) return { ok: false, identifie: false, message: 'Merci de remplir les trois champs.' };

  const cache = CacheService.getScriptCache();
  const cle = cleEssais(saisie);
  const essais = Number(cache.get(cle) || 0);
  if (essais >= CONFIG.MAX_ESSAIS) {
    journaliser(nom, prenom, saisie.date, 'BLOQUÉ', '');
    return {
      ok: false, identifie: false,
      message: 'Trop de tentatives. Réessayez dans ' + CONFIG.BLOCAGE_MINUTES +
               ' minutes ou contactez ' + CONFIG.CONTACT + '.'
    };
  }

  try {
    const res = trouverAdherent(saisie);
    if (!res.trouve) {
      cache.put(cle, String(essais + 1), CONFIG.BLOCAGE_MINUTES * 60);
      journaliser(nom, prenom, saisie.date, 'NON TROUVÉ', '');
      return {
        ok: false, identifie: false,
        message: 'Aucun amicaliste ne correspond à ces informations. Vérifiez l\'orthographe et la date, ' +
                 'ou contactez ' + CONFIG.CONTACT + '.'
      };
    }

    cache.remove(cle);
    const numero = String(res.ligne[res.col.num] || '').trim();
    const email = String(res.ligne[res.col.email] || '').trim();
    const emailMasque = email ? masquerEmail(email) : '';

    if (!numero) {
      journaliser(nom, prenom, saisie.date, 'TROUVÉ SANS NUMÉRO', '');
      return {
        ok: false, identifie: true, emailMasque: emailMasque,
        message: 'Vous êtes bien enregistré, mais aucun numéro FNSPF n\'est renseigné pour vous. ' +
                 'Contactez ' + CONFIG.CONTACT + ' si besoin.'
      };
    }

    journaliser(nom, prenom, saisie.date, 'OK', '');
    return {
      ok: true, identifie: true, numero: numero, emailMasque: emailMasque,
      message: 'Voici votre numéro d\'adhérent FNSPF :'
    };
  } catch (e) {
    return { ok: false, identifie: false, message: 'Service momentanément indisponible. Contactez ' + CONFIG.CONTACT + '.' };
  }
}

/**
 * Enregistrement de l'email. Re-vérifie l'identité côté serveur.
 * Si un email différent existe déjà, il n'est PAS écrasé : la demande part au Journal pour validation.
 */
function enregistrerEmail(nom, prenom, dateNaissance, email, consentement) {
  const saisie = controlerSaisie(nom, prenom, dateNaissance);
  email = String(email || '').trim().toLowerCase();

  if (!saisie) return { ok: false, message: 'Identification incomplète.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, message: 'Adresse email invalide.' };
  if (consentement !== true) return { ok: false, message: 'Merci de cocher la case d\'accord.' };

  const cache = CacheService.getScriptCache();
  if (Number(cache.get(cleEssais(saisie)) || 0) >= CONFIG.MAX_ESSAIS) {
    return { ok: false, message: 'Trop de tentatives. Réessayez plus tard.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const res = trouverAdherent(saisie);
    if (!res.trouve) return { ok: false, message: 'Identification impossible.' };

    const actuel = String(res.ligne[res.col.email] || '').trim().toLowerCase();

    if (actuel === email) {
      return { ok: true, message: 'Cette adresse est déjà enregistrée. Merci !' };
    }

    if (actuel) {
      journaliser(nom, prenom, saisie.date, 'DEMANDE MODIF EMAIL (à valider)', actuel + ' → ' + email);
      return {
        ok: true,
        message: 'Une adresse existe déjà pour vous. Votre demande de modification a été transmise au bureau.'
      };
    }

    res.feuille.getRange(res.numLigne, res.col.email + 1).setValue(email);
    res.feuille.getRange(res.numLigne, res.col.consent + 1).setValue(new Date());
    journaliser(nom, prenom, saisie.date, 'EMAIL ENREGISTRÉ', email);
    return { ok: true, message: 'Merci, votre adresse email est enregistrée.' };
  } catch (e) {
    return { ok: false, message: 'Service momentanément indisponible. Contactez ' + CONFIG.CONTACT + '.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Recherche ----------

function trouverAdherent(saisie) {
  const feuille = classeur().getSheetByName(CONFIG.ONGLET_BASE);
  if (!feuille) throw new Error('Onglet "' + CONFIG.ONGLET_BASE + '" introuvable.');

  const col = colonnes(feuille);
  const donnees = feuille.getDataRange().getValues();

  for (var r = 1; r < donnees.length; r++) {
    const ligne = donnees[r];
    if (normaliser(ligne[col.nom]) === saisie.nom &&
        normaliser(ligne[col.prenom]) === saisie.prenom &&
        dateEnIso(ligne[col.date]) === saisie.date) {
      return { trouve: true, feuille: feuille, ligne: ligne, numLigne: r + 1, col: col };
    }
  }
  return { trouve: false };
}

/** Repère les colonnes par leur en-tête, crée Email / Consentement si absentes */
function colonnes(feuille) {
  var entetes = feuille.getRange(1, 1, 1, feuille.getLastColumn()).getValues()[0];
  const idx = function (nomCol) {
    return entetes.map(function (h) { return normaliser(h); }).indexOf(normaliser(nomCol));
  };
  const ajouter = function (nomCol) {
    const c = feuille.getLastColumn() + 1;
    feuille.getRange(1, c).setValue(nomCol).setFontWeight('bold');
    entetes = feuille.getRange(1, 1, 1, c).getValues()[0];
  };
  if (idx(CONFIG.COL_EMAIL) === -1) ajouter(CONFIG.COL_EMAIL);
  if (idx(CONFIG.COL_CONSENTEMENT) === -1) ajouter(CONFIG.COL_CONSENTEMENT);

  const col = {
    nom: idx(CONFIG.COL_NOM), prenom: idx(CONFIG.COL_PRENOM),
    date: idx(CONFIG.COL_NAISSANCE), num: idx(CONFIG.COL_NUMERO),
    email: idx(CONFIG.COL_EMAIL), consent: idx(CONFIG.COL_CONSENTEMENT)
  };
  if ([col.nom, col.prenom, col.date, col.num].indexOf(-1) !== -1) {
    throw new Error('En-têtes de colonnes incorrects dans l\'onglet "' + CONFIG.ONGLET_BASE + '".');
  }
  return col;
}

// ---------- Outils ----------

function controlerSaisie(nom, prenom, date) {
  const s = { nom: normaliser(nom), prenom: normaliser(prenom), date: String(date || '').trim() };
  if (!s.nom || !s.prenom || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return null;
  return s;
}

function cleEssais(saisie) {
  return 'essais_' + Utilities.base64EncodeWebSafe(saisie.nom + '|' + saisie.prenom).slice(0, 200);
}

/** Minuscules, sans accents, sans tirets ni espaces superflus */
function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** jean.dupont@gmail.com -> je*********@gmail.com */
function masquerEmail(email) {
  const p = email.split('@');
  if (p.length !== 2) return '';
  return p[0].slice(0, 2) + '*'.repeat(Math.max(p[0].length - 2, 3)) + '@' + p[1];
}

/** Convertit une date (cellule date ou texte JJ/MM/AAAA) en AAAA-MM-JJ */
function dateEnIso(valeur) {
  if (valeur instanceof Date && !isNaN(valeur)) {
    return Utilities.formatDate(valeur, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(valeur || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/** Trace chaque demande dans l'onglet Journal */
function journaliser(nom, prenom, date, resultat, detail) {
  const ss = classeur();
  var journal = ss.getSheetByName(CONFIG.ONGLET_JOURNAL);
  if (!journal) {
    journal = ss.insertSheet(CONFIG.ONGLET_JOURNAL);
    journal.appendRow(['Horodatage', 'Nom saisi', 'Prénom saisi', 'Date saisie', 'Résultat', 'Détail']);
    journal.setFrozenRows(1);
  }
  journal.appendRow([new Date(), nom, prenom, date, resultat, detail || '']);
}

