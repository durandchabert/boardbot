import { Router } from 'express';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ShadingType,
} from 'docx';
import { getSession } from '../db/sessionRepo.js';
import { getUtterancesBySession } from '../db/utteranceRepo.js';

const router = Router();

// Formater un timestamp (secondes) en MM:SS
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// GET /api/sessions/:id/transcript — retourne le transcript JSON avec noms des speakers
router.get('/:id/transcript', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const utterances = getUtterancesBySession(req.params.id);
  res.json({ session, utterances });
});

// GET /api/sessions/:id/transcript/docx — génère et télécharge un fichier Word
router.get('/:id/transcript/docx', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const utterances = getUtterancesBySession(req.params.id);

  // Build paragraphs
  const paragraphs: Paragraph[] = [];

  // Title
  paragraphs.push(
    new Paragraph({
      text: session.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // Session metadata
  const sessionDate = new Date(session.created_at).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Date : ', bold: true, size: 20 }),
        new TextRun({ text: sessionDate, size: 20 }),
      ],
      spacing: { after: 80 },
    })
  );

  // Participants list
  const uniqueSpeakers = [...new Map(utterances.map((u) => [u.speaker_label, u])).values()];
  if (uniqueSpeakers.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: 'Participants : ', bold: true, size: 20 })],
        spacing: { before: 80, after: 40 },
      })
    );
    for (const sp of uniqueSpeakers) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${sp.display_name}`, size: 20 })],
          spacing: { after: 40 },
          indent: { left: 360 },
        })
      );
    }
  }

  // Separator
  paragraphs.push(
    new Paragraph({
      text: '',
      border: {
        bottom: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { before: 200, after: 200 },
    })
  );

  // Transcript heading
  paragraphs.push(
    new Paragraph({
      text: 'Transcript',
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 200 },
    })
  );

  // Utterances
  if (utterances.length === 0) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: 'Aucune transcription disponible.', italics: true, color: '888888', size: 20 })],
      })
    );
  } else {
    for (const u of utterances) {
      // Speaker label row
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: u.display_name,
              bold: true,
              size: 20,
              color: '1a1a2e',
            }),
            new TextRun({
              text: `  ${formatTime(u.start_time)}`,
              size: 18,
              color: '888888',
            }),
          ],
          spacing: { before: 200, after: 40 },
        })
      );

      // Speech text row
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: u.transcript,
              size: 20,
              color: '333333',
            }),
          ],
          spacing: { after: 60 },
          indent: { left: 360 },
        })
      );
    }
  }

  // Export timestamp footer
  paragraphs.push(
    new Paragraph({
      text: '',
      border: {
        top: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { before: 400, after: 80 },
    })
  );
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Exporté le ${new Date().toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}`,
          italics: true,
          size: 18,
          color: '888888',
        }),
      ],
    })
  );

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font: 'Calibri', size: 20 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  const filename = `transcript-${session.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export default router;
