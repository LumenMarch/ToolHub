import React from 'react';
import {
  TtStationBoxPlotChart,
  TtStationQ3LineChart,
} from './charts';
import type { StationBoxGroup } from './lib';
import { StationComparisonTable } from './StationComparisonTable';
import type { ActiveModule } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  activeModule: ActiveModule;
  fileName: string;
  allStationBoxGroups: StationBoxGroup[];
};

export const TtTimeExtraModules: React.FC<Props> = ({
  activeModule,
  fileName,
  allStationBoxGroups,
}) => {
  if (activeModule === 'boxplot') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>机台测试时间箱线图</CardTitle>
        </CardHeader>
        <CardContent>
          {allStationBoxGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">未检索到机台数据</p>
          ) : (
            <TtStationBoxPlotChart
              groups={allStationBoxGroups.slice(0, 10)}
              lockdownTT={null}
              className="w-full"
            />
          )}
        </CardContent>
      </Card>
    );
  }

  if (activeModule === 'comparison') {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>各机台五数统计数据</CardTitle>
          </CardHeader>
          <CardContent>
            <StationComparisonTable
              groups={allStationBoxGroups}
              title={`${fileName} 各机台数据对比`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>各机台 Q3 耗时对比折线图</CardTitle>
          </CardHeader>
          <CardContent>
            <TtStationQ3LineChart
              groups={allStationBoxGroups}
              referenceLines={[]}
              className="w-full"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
};
