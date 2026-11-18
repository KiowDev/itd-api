import { describe, expect, it } from 'vitest';
import { operationBucket } from '../../src/domain/operations.js';
import { type BannerDrawing, BannerDrawingTool, ItdClient } from '../../src/index.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

const drawing = {
  version: 1,
  width: 1100,
  height: 380,
  ops: [
    {
      tool: BannerDrawingTool.Line,
      color: '#3366ff',
      width: 8,
      points: [
        [40, 190],
        [1060, 190],
      ],
    },
    { tool: BannerDrawingTool.Eraser, color: '#000000', width: 4, points: [[550, 190]] },
  ],
} satisfies BannerDrawing;

function setup(response: Response) {
  const mock = createMockFetch([response]);
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    auth: 'access-token',
    fetch: mock.fetch,
    rateLimit: false,
  });
  return { itd, mock };
}

describe('загрузка рисунка для баннера', () => {
  it('отправляет операции в исходном порядке и возвращает данные изображения', async () => {
    const image = {
      id: 'drawing-id',
      url: 'https://cdn.test/banner.png',
      width: 1100,
      height: 380,
    };
    const { itd, mock } = setup(json({ data: image }, { status: 201 }));

    await expect(itd.files.uploadBannerDrawing(drawing)).resolves.toEqual(image);
    const [request] = mock.calls;
    expect(mock.callCount).toBe(1);
    expect(request?.url).toBe('https://itd.test/api/files/banner-drawing');
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe('Bearer access-token');
    expect(request?.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(request?.body ?? '{}')).toEqual(drawing);
    expect(operationBucket('files.uploadBannerDrawing')).toBe(operationBucket('files.upload'));
  });

  it('возвращает ошибку загрузки без автоматического повтора после 503', async () => {
    const { itd, mock } = setup(json({ error: { message: 'Unavailable' } }, { status: 503 }));

    await expect(itd.files.uploadBannerDrawing(drawing)).rejects.toMatchObject({ status: 503 });
    expect(mock.callCount).toBe(1);
  });
});
