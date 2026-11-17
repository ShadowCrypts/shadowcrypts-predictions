import { getUfcModel } from '../../../../lib/ufc/model';
import { fightImage, SIZE } from '../../../components/ufc/fightImage';
import { mainFirst } from '../../../components/ufc/UfcBits';

export const alt = 'UFC card forecast';
export const size = SIZE;
export const contentType = 'image/png';

/** Link preview for a card: its main event's fighters and chances, under the event's name. */
export default async function EventImage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const model = /^\d{1,15}$/.test(eventId) ? await getUfcModel().catch(() => null) : null;
  const event = model?.eventsById.get(eventId);
  return fightImage(model, event ? mainFirst(event)[0] : undefined, event, event?.name);
}
