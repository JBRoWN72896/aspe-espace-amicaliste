# ASPE | Espace amicaliste

Page en libre-service pour les amicalistes de l'Amicale des Sapeurs-Pompiers d'Évreux :

- retrouver son **numéro d'adhérent FNSPF** (nom + prénom + date de naissance) ;
- laisser ou mettre à jour son **adresse email** (avec accord RGPD).

## Fonctionnement

```
Amicaliste ──► Page publique (GitHub Pages, index.html)
                     │  requête
                     ▼
               Script Google (apps-script/Code.gs)
                     │  lecture / écriture
                     ▼
               Google Sheet PRIVÉ (base des adhérents)
```

**Aucune donnée d'adhérent n'est stockée sur GitHub.** La base reste dans un Google Sheet privé. Le dépôt ne contient que la page et le code.

## Installation

### 1. Base et script (Google)

1. Importer la base Excel dans Google Drive, l'ouvrir avec Google Sheets puis *Fichier > Enregistrer au format Google Sheets*. L'onglet doit s'appeler `Adherents`.
2. Dans le Sheet : *Extensions > Apps Script*. Remplacer le contenu de `Code.gs` par celui de [`apps-script/Code.gs`](apps-script/Code.gs). Adapter la ligne `CONTACT` si besoin. Enregistrer.
3. *Déployer > Nouveau déploiement > Application Web* :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
4. Autoriser l'accès (avertissement « application non validée » : *Paramètres avancés > Accéder au projet*).
5. Copier l'URL qui se termine par `/exec`.

### 2. Page (GitHub)

1. Dans `index.html`, remplacer `COLLER_ICI_URL_APPS_SCRIPT` par l'URL `/exec`.
2. *Settings > Pages* : Source **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Le lien à partager : `https://jbrown72896.github.io/aspe-espace-amicaliste/`

## Mises à jour

- Ajouter ou corriger un adhérent : directement dans le Google Sheet, rien à republier.
- Modifier le script : *Déployer > Gérer les déploiements > Modifier > Nouvelle version* (l'URL reste la même).
- Suivi des demandes : onglet `Journal` du Sheet (créé automatiquement).

## Sécurité

- 5 essais ratés sur un même nom : blocage 1 heure.
- Un email existant n'est jamais écrasé : la demande de modification part dans le Journal pour validation.
- Le fichier `.gitignore` empêche de publier par erreur un fichier Excel, CSV ou PDF.
