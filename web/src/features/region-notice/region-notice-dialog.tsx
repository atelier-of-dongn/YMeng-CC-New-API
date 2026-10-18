/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { CheckCircle2, Info, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

import type { RegionModelEntry } from './api'
import { useRegionNotice } from './use-region-notice'

type ModelListProps = {
  models: RegionModelEntry[]
  variant: 'available' | 'restricted'
  emptyText: string
}

function ModelList(props: ModelListProps) {
  if (props.models.length === 0) {
    return (
      <p className='text-muted-foreground py-6 text-center text-sm'>
        {props.emptyText}
      </p>
    )
  }

  return (
    <ul className='flex flex-col gap-1.5'>
      {props.models.map((item) => (
        <li
          key={item.model_name}
          className='flex flex-col gap-1 rounded-md border px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-3'
        >
          <span
            className={cn(
              'font-mono text-sm break-all',
              props.variant === 'restricted' && 'text-muted-foreground'
            )}
          >
            {item.model_name}
          </span>
          <span className='flex flex-wrap gap-1 sm:justify-end'>
            {item.groups.map((group) => (
              <Badge
                key={group}
                variant='outline'
                className='border-border/60 bg-muted/30 text-muted-foreground'
              >
                {group}
              </Badge>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 大陆访客的模型可见性提示弹窗。
 * 同时列出当前可用模型与仅海外可访问的模型，说明差异原因。
 * 该弹窗面向大陆网络访客，文案强制使用简体中文展示，不随界面语言切换。
 */
export function RegionNoticeDialog() {
  const { t } = useTranslation()
  const { systemName, logo } = useSystemConfig()
  const { notice, open, close } = useRegionNotice()
  const [keyword, setKeyword] = useState('')
  const [dontRemindToday, setDontRemindToday] = useState(false)

  const filtered = useMemo(() => {
    if (!notice) return { available: [], overseas: [] }
    const needle = keyword.trim().toLowerCase()
    const match = (item: RegionModelEntry) =>
      needle === '' || item.model_name.toLowerCase().includes(needle)
    return {
      available: notice.available_models.filter(match),
      overseas: notice.overseas_only_models.filter(match),
    }
  }, [notice, keyword])

  const zh = (key: string, options?: Record<string, unknown>) =>
    t(key, { ...options, lng: 'zhCN' })

  if (!notice) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 点遮罩或按 Esc 关闭时，同样尊重勾选状态。
        if (!next) close(dontRemindToday)
      }}
      title={
        <div className='flex flex-col gap-2 sm:gap-2.5'>
          <div className='flex items-center gap-2'>
            <div className='flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md'>
              <img
                src={logo}
                alt=''
                className='size-full rounded-md object-cover'
              />
            </div>
            <span className='text-foreground truncate text-sm font-semibold'>
              {systemName}
            </span>
          </div>
          <span className='text-base font-semibold tracking-tight'>
            {zh('Model availability in your region')}
          </span>
        </div>
      }
      description={zh(
        'We detected you are accessing from a mainland China network. Below are the models you can use now and the ones available only to overseas networks.'
      )}
      titleClassName='contents'
      descriptionClassName='max-sm:text-xs max-sm:leading-relaxed'
      contentClassName='max-h-[calc(100dvh-1rem)] max-sm:w-[calc(100vw-1rem)] max-sm:gap-3 max-sm:rounded-lg max-sm:p-3 sm:max-w-3xl'
      footerClassName='max-sm:-mx-3 max-sm:-mb-3 max-sm:p-3'
      footer={
        <div className='grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between'>
          <div className='flex min-w-0 items-center gap-2'>
            <Checkbox
              id='region-notice-snooze'
              checked={dontRemindToday}
              onCheckedChange={(checked) =>
                setDontRemindToday(checked === true)
              }
            />
            <Label
              htmlFor='region-notice-snooze'
              className='text-muted-foreground min-w-0 text-sm leading-tight font-normal'
            >
              {zh('Do not remind today')}
            </Label>
          </div>
          <Button
            onClick={() => close(dontRemindToday)}
            className='shrink-0 px-4 sm:w-auto'
          >
            {zh('I understand')}
          </Button>
        </div>
      }
    >
      <div className='flex flex-col gap-3 sm:gap-4'>
        <Alert className='border-info/25 bg-info/10 text-info'>
          <Info aria-hidden='true' />
          <AlertDescription className='text-info text-xs leading-relaxed sm:text-sm'>
            {zh(
              'This API service is strictly limited to personal learning and technical research use. Please do not use it for any commercial or illegal purpose.'
            )}
          </AlertDescription>
        </Alert>

        {/* 窄屏也保持三列并排，避免纵向堆叠挤压下方模型列表 */}
        <div className='grid grid-cols-3 gap-1.5 sm:gap-3'>
          <div className='border-success/25 bg-success/10 min-w-0 rounded-lg border p-2 sm:p-3'>
            <p className='text-success text-xs leading-tight font-medium'>
              {zh('Available now')}
            </p>
            <p className='text-success mt-1 text-xl leading-none font-semibold tabular-nums'>
              {notice.available_model_count}
            </p>
          </div>
          <div className='border-warning/30 bg-warning/10 min-w-0 rounded-lg border p-2 sm:p-3'>
            <p className='text-warning text-xs leading-tight font-medium'>
              {zh('Overseas only')}
            </p>
            <p className='text-warning mt-1 text-xl leading-none font-semibold tabular-nums'>
              {notice.overseas_model_count}
            </p>
          </div>
          <div className='border-border/60 bg-muted/30 min-w-0 rounded-lg border p-2 sm:p-3'>
            <p className='text-muted-foreground text-xs leading-tight font-medium'>
              {zh('Total models')}
            </p>
            <p className='mt-1 text-xl leading-none font-semibold tabular-nums'>
              {notice.total_model_count}
            </p>
          </div>
        </div>

        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={zh('Search model names')}
        />

        {/* 移动端复用弹窗主体滚动，桌面端保留模型列表的独立滚动区域。 */}
        <ScrollArea className='h-auto pr-0 sm:h-[320px] sm:pr-3 max-sm:[&_[data-slot=scroll-area-scrollbar]]:hidden'>
          <div className='flex flex-col gap-4'>
            <section className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <CheckCircle2
                  className='text-success size-4'
                  aria-hidden='true'
                />
                <h4 className='text-sm font-medium'>
                  {zh('Available to you now ({{count}})', {
                    count: filtered.available.length,
                  })}
                </h4>
              </div>
              <ModelList
                models={filtered.available}
                variant='available'
                emptyText={zh('No matching available models')}
              />
            </section>

            <Separator />

            <section className='flex flex-col gap-2'>
              <div className='flex items-center gap-2'>
                <Lock className='text-warning size-4' aria-hidden='true' />
                <h4 className='text-sm font-medium'>
                  {zh('Overseas networks only ({{count}})', {
                    count: filtered.overseas.length,
                  })}
                </h4>
              </div>
              <p className='text-muted-foreground text-xs'>
                {zh(
                  'The following models belong to groups that are not opened to mainland China networks. An overseas network environment is required to use them in the web interface.'
                )}
              </p>
              <ModelList
                models={filtered.overseas}
                variant='restricted'
                emptyText={zh('No matching restricted models')}
              />
            </section>
          </div>
        </ScrollArea>
      </div>
    </Dialog>
  )
}
