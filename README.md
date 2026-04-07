# BoardBot

Whiteboard collaboratif alimenté par IA en temps réel. Pendant une réunion, un bot audio transcrit les participants, identifie qui parle, et génère automatiquement des post-it sur un board partagé.

## Architecture

```
/boardbot
├── /frontend        ← React + TypeScript + Vite (board visuel)
├── /backend         ← Express + Socket.IO + pipeline IA
└── /shared          ← Types TypeScript partagés
```

### Pipeline audio → post-it

1. Le micro du navigateur capture l'audio
2. L'audio est streamé vers le backend via `/api/sessions/:id/audio`
3. Le backend transmet à Deepgram (STT avec diarisation)
4. `IdeaDetector` filtre les utterances pertinentes par mots-clés et catégorie
5. Claude Haiku compresse chaque idée en post-it de 5-10 mots
6. Le post-it est sauvé en SQLite et diffusé en temps réel via Socket.IO

### Stack technique

- **Frontend** : React 18, TypeScript, Vite, CSS Modules
- **Board** : Layout HTML/CSS en colonnes (Idées / Problèmes / Actions)
- **Backend** : Node.js, Express, Socket.IO
- **STT** : Deepgram Nova-2 (streaming WebSocket, diarisation, français)
- **LLM** : Claude Haiku (compression en post-it)
- **DB** : SQLite via better-sqlite3

## Setup

### Prérequis

- Node.js >= 18
- Clé API Deepgram (https://console.deepgram.com)
- Clé API Anthropic (https://console.anthropic.com)

### Installation

```bash
cd boardbot
cp .env.example .env
# Remplir DEEPGRAM_API_KEY et ANTHROPIC_API_KEY dans .env

npm install
npm run dev
```

Ceci lance le frontend (http://localhost:5173) et le backend (http://localhost:3001) en parallèle.

## Utilisation

1. **Créer une session** : entrez un titre de réunion sur la page d'accueil
2. **Configurer les participants** : ajoutez les noms et mappez les speaker labels
3. **Lancer le board** : le board s'affiche avec 3 colonnes (Idées, Problèmes, Actions)
4. **Démarrer l'écoute** : cliquez sur le bouton micro pour commencer la transcription
5. **Valider/rejeter les notes** : les post-it suggérés apparaissent en pointillés, validez ou rejetez
6. **Récapitulatif** : terminez la session pour voir le résumé et exporter en JSON

## Variables d'environnement

| Variable | Description |
|---|---|
| `DEEPGRAM_API_KEY` | Clé API Deepgram pour la transcription |
| `ANTHROPIC_API_KEY` | Clé API Anthropic pour la génération de post-it |
| `PORT` | Port du backend (défaut: 3001) |
| `FRONTEND_URL` | URL du frontend pour CORS (défaut: http://localhost:5173) |

## API Endpoints

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/sessions` | Créer une session |
| `GET` | `/api/sessions/:id` | Récupérer une session |
| `POST` | `/api/sessions/:id/participants` | Ajouter un participant |
| `POST` | `/api/sessions/:id/audio` | Envoyer un chunk audio |
| `POST` | `/api/sessions/:id/end` | Terminer une session |
| `GET` | `/api/sessions/:id/notes` | Lister les notes |
| `POST` | `/api/sessions/:id/notes` | Créer une note manuellement |
| `PATCH` | `/api/notes/:id` | Modifier une note |
| `DELETE` | `/api/notes/:id` | Supprimer une note |
| `POST` | `/api/sessions/:id/summary` | Générer un résumé IA |

## Socket.IO Events

### Serveur → Client
- `note:created` — Nouvelle note générée
- `note:updated` — Note modifiée (statut, texte)
- `note:deleted` — Note supprimée
- `transcript:live` — Transcription en temps réel
- `session:ended` — Session terminée

### Client → Serveur
- `session:join` — Rejoindre une session
- `note:validate` — Valider une note
- `note:reject` — Rejeter une note
- `note:edit` — Éditer le texte d'une note
