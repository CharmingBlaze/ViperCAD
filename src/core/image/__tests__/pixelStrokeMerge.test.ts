import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { CommandHistory } from '@/core/history/CommandHistory';
import { resetIdCounter } from '@/core/ids/IdService';
import { createImageAsset, getPixel, setPixel } from '@/core/image/PixelEditor';
import { PixelStrokeRecorder } from '@/core/image/PixelStroke';

beforeEach(() => resetIdCounter(1));

describe('pixel paint undo merging', () => {
  it('merges consecutive strokes on the same image into one undo step', () => {
    const doc = createEmptyDocument();
    const image = createImageAsset(doc, 'Paint', 8, 8, [0, 0, 0, 255]);
    const history = new CommandHistory();
    const recorder = new PixelStrokeRecorder();
    let applies = 0;
    const onApply = () => {
      applies += 1;
    };

    recorder.begin(image);
    const prev0 = getPixel(image, 1, 1)!;
    setPixel(image, 1, 1, [255, 0, 0, 255]);
    recorder.paint(1, 1, prev0, [255, 0, 0, 255]);
    expect(recorder.commit(history, onApply)).toBe(true);

    recorder.begin(image);
    const prev1 = getPixel(image, 2, 1)!;
    setPixel(image, 2, 1, [0, 255, 0, 255]);
    recorder.paint(2, 1, prev1, [0, 255, 0, 255]);
    expect(recorder.commit(history, onApply)).toBe(true);

    expect(history.getUndoNames()).toEqual(['Paint Pixels']);
    expect(getPixel(image, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(image, 2, 1)).toEqual([0, 255, 0, 255]);

    expect(history.undo()).toBe(true);
    expect(getPixel(image, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(getPixel(image, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(applies).toBeGreaterThan(0);

    expect(history.redo()).toBe(true);
    expect(getPixel(image, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(image, 2, 1)).toEqual([0, 255, 0, 255]);
  });

  it('does not merge paint from a different image', () => {
    const doc = createEmptyDocument();
    const a = createImageAsset(doc, 'A', 4, 4, [0, 0, 0, 255]);
    const b = createImageAsset(doc, 'B', 4, 4, [0, 0, 0, 255]);
    const history = new CommandHistory();
    const recorder = new PixelStrokeRecorder();
    const onApply = () => undefined;

    recorder.begin(a);
    const prevA = getPixel(a, 0, 0)!;
    setPixel(a, 0, 0, [255, 0, 0, 255]);
    recorder.paint(0, 0, prevA, [255, 0, 0, 255]);
    recorder.commit(history, onApply);

    recorder.begin(b);
    const prevB = getPixel(b, 0, 0)!;
    setPixel(b, 0, 0, [0, 255, 0, 255]);
    recorder.paint(0, 0, prevB, [0, 255, 0, 255]);
    recorder.commit(history, onApply);

    expect(history.getUndoNames()).toEqual(['Paint Pixels', 'Paint Pixels']);
  });
});
