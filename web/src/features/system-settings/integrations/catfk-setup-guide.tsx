import { HelpCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

const catfkMerchantConsoleUrl = 'https://catfk.com/merchant'

export function CatFKSetupGuide() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Yunmao payment setup guide')}
      description={t(
        'Follow these steps to find the store token and goods keys in your Yunmao merchant account.'
      )}
      contentClassName='sm:max-w-xl'
      bodyClassName='text-sm break-words'
      showCloseButton={false}
      trigger={
        <Button type='button' variant='outline' size='sm'>
          <HelpCircle className='mr-1 h-4 w-4' aria-hidden='true' />
          {t('Setup guide')}
        </Button>
      }
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => setOpen(false)}
          >
            {t('Close')}
          </Button>
          <Button
            role='link'
            render={
              <a
                href={catfkMerchantConsoleUrl}
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            {t('Open Yunmao merchant console')}
          </Button>
        </>
      }
    >
      <ol className='list-decimal space-y-5 pl-5'>
        <li className='space-y-1.5'>
          <h3 className='font-medium'>{t('Get the store token')}</h3>
          <p className='text-muted-foreground'>
            {t(
              'Sign in to the Yunmao merchant console and open your store page.'
            )}
          </p>
          <p className='text-muted-foreground'>
            {t(
              'Copy the part of the store link after /shop/ and paste it into the store token field. You can also paste the full store link.'
            )}
          </p>
          <p className='text-muted-foreground'>
            {t('Example')}:{' '}
            <code className='bg-muted text-foreground rounded px-1.5 py-0.5 text-xs'>
              https://catfk.com/shop/YourShop
            </code>{' '}
            →{' '}
            <code className='bg-muted text-foreground rounded px-1.5 py-0.5 text-xs'>
              YourShop
            </code>
          </p>
        </li>
        <li className='space-y-1.5'>
          <h3 className='font-medium'>{t('Prepare the products')}</h3>
          <p className='text-muted-foreground'>
            {t(
              'Create one card-code product for each top-up tier. Keep it on sale and in stock.'
            )}
          </p>
          <p className='text-muted-foreground'>
            {t(
              'Set the contact format to Any or QQ, and set the purchase limit to 1 per order.'
            )}
          </p>
        </li>
        <li className='space-y-1.5'>
          <h3 className='font-medium'>{t('Add product mappings')}</h3>
          <p className='text-muted-foreground'>
            {t(
              'Open the product page and copy the part of the product link after /item/. Paste only this part into the goods key field.'
            )}
          </p>
          <p className='text-muted-foreground'>
            {t('Example')}:{' '}
            <code className='bg-muted text-foreground rounded px-1.5 py-0.5 text-xs'>
              https://catfk.com/item/jbf7yz
            </code>{' '}
            →{' '}
            <code className='bg-muted text-foreground rounded px-1.5 py-0.5 text-xs'>
              jbf7yz
            </code>
          </p>
          <p className='text-muted-foreground'>
            {t(
              'Set the expected credited balance (USD) to a top-up amount option in General, not the CNY selling price.'
            )}
          </p>
          <p className='text-muted-foreground'>
            {t(
              'Choose your own stable product ID. It cannot be changed later.'
            )}
          </p>
        </li>
        <li className='space-y-1.5'>
          <h3 className='font-medium'>{t('Choose channels and enable')}</h3>
          <p className='text-muted-foreground'>
            {t(
              'Click {{read}}, select the channels to offer, turn on payments, then click {{save}}.',
              {
                read: t('Read CatFK channels'),
                save: t('Save all settings'),
              }
            )}
          </p>
          <p className='text-muted-foreground'>
            {t(
              'The server must also set CATFK_ORDER_ENCRYPTION_KEY to a Base64 value that decodes to 32 bytes.'
            )}
          </p>
        </li>
      </ol>
    </Dialog>
  )
}
