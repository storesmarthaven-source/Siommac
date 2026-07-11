import type { Orientation, PageSize } from '@/types';
import { PAGE_SIZE_LABELS } from '@/constants/pageSizes';
import { useDesigner } from '@/state/DesignerContext';
import { ColorField } from '@/components/color/ColorField';
import { Row, Segmented, Select } from '@/components/ui/controls';

const SIZE_OPTIONS = (['a4', 'letter', 'legal', 'half'] as const).map((v) => ({
  value: v,
  label: PAGE_SIZE_LABELS[v],
}));

export function PageSetupPanel() {
  const { state, dispatch } = useDesigner();
  const { page } = state.design;

  return (
    <div class="insp">
      <Row label="Size">
        <Select<PageSize>
          value={page.size}
          options={SIZE_OPTIONS}
          onChange={(size) => dispatch({ kind: 'setPage', patch: { size } })}
        />
      </Row>
      <Row label="Orient.">
        <Segmented<Orientation>
          value={page.orient}
          options={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ]}
          onChange={(orient) => dispatch({ kind: 'setPage', patch: { orient } })}
        />
      </Row>
      <Row label="Background">
        <ColorField
          value={page.bg}
          onChange={(bg) => dispatch({ kind: 'setPage', patch: { bg } })}
        />
      </Row>
    </div>
  );
}
