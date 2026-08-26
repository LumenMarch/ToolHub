/** 图表导出：SVG 序列化 / 位图栅格化。独立成模块保持组件文件 fast-refresh 纯净。 */

/** 主题令牌 → SVG 内联样式（CSS 变量在独立 SVG / canvas 中不可解析）。 */
const applyThemeStyles = (source: SVGSVGElement, target: SVGSVGElement) => {
  const PROPERTIES = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-dasharray',
    'font-family',
    'font-size',
    'font-weight',
    'letter-spacing',
    'opacity',
  ];
  const sourceElements = [source, ...Array.from(source.querySelectorAll('*'))];
  const targetElements = [target, ...Array.from(target.querySelectorAll('*'))];
  sourceElements.forEach((element, index) => {
    const counterpart = targetElements[index];
    if (!counterpart || element.nodeType !== 1 || counterpart.nodeType !== 1) {
      return;
    }
    const computed = getComputedStyle(element as Element);
    for (const property of PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) {
        (counterpart as SVGElement).style.setProperty(property, value);
      }
    }
  });
};

const serializeSvg = (source: SVGSVGElement): string => {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(source.viewBox.baseVal.width));
  clone.setAttribute('height', String(source.viewBox.baseVal.height));
  applyThemeStyles(source, clone);
  return new XMLSerializer().serializeToString(clone);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** 导出当前图表为 SVG 文件。 */
export const exportSvg = (svgElement: SVGSVGElement, baseName: string) => {
  const xml = serializeSvg(svgElement);
  downloadBlob(
    new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
    `${baseName}.svg`,
  );
};

/** 导出当前图表为 2x 位图 PNG。 */
export const exportPng = async (
  svgElement: SVGSVGElement,
  baseName: string,
): Promise<void> => {
  const xml = serializeSvg(svgElement);
  const svgUrl = URL.createObjectURL(
    new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG 渲染失败'));
      image.src = svgUrl;
    });

    const width = svgElement.viewBox.baseVal.width;
    const height = svgElement.viewBox.baseVal.height;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 初始化失败');
    }
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) {
      throw new Error('PNG 编码失败');
    }
    downloadBlob(blob, `${baseName}.png`);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};
