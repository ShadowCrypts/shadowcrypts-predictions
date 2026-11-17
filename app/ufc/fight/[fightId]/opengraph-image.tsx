import { getUfcModel } from '../../../../lib/ufc/model';
import { fightImage, SIZE } from '../../../components/ufc/fightImage';

export const alt = 'UFC fight forecast';
export const size = SIZE;
export const contentType = 'image/png';

/** Link preview for a fight: both fighters and their chances (or the result). */
export default async function FightImage({ params }: { params: Promise<{ fightId: string }> }) {
  const { fightId } = await params;
  const model = /^\d{1,15}$/.test(fightId) ? await getUfcModel().catch(() => null) : null;
  const bout = model?.boutsById.get(fightId);
  return fightImage(model, bout, bout ? model?.eventsById.get(bout.eventId) : undefined);
}
