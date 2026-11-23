'use client';

import type { ItemDto, VendorContactDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { setItemVendor, setVendorContacts } from '../../actions/procurement';
import { formatPhone } from '../../screens/format';
import { ItemPicker } from '../catalogue/item-picker';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** The most people a vendor keeps (`VENDOR_CONTACTS_MAX`). */
const MAX_PEOPLE = 20;

interface PersonDraft {
  key: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}

const draftOf = (c: VendorContactDto): PersonDraft => ({
  key: c.id,
  name: c.name,
  role: c.role ?? '',
  phone: c.phone === null ? '' : formatPhone(c.phone),
  email: c.email ?? '',
});

/**
 * A vendor's people as a set: each with a name and, when known, a role, a mobile number and an
 * email. Saving replaces the people the vendor had.
 */
export function ContactsDialog({
  vendorId,
  vendorName,
  contacts,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  vendorId: string;
  vendorName: string;
  contacts: readonly VendorContactDto[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('procurement.peopleForm');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setVendorContacts);
  const [people, setPeople] = useState<PersonDraft[]>(() => contacts.map(draftOf));
  const [nameMissing, setNameMissing] = useState(false);

  function change(key: string, field: keyof Omit<PersonDraft, 'key'>, value: string) {
    setPeople((all) => all.map((p) => (p.key === key ? { ...p, [field]: value } : p)));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const kept = people.filter(
      (p) =>
        p.name.trim() !== '' ||
        p.role.trim() !== '' ||
        p.phone.trim() !== '' ||
        p.email.trim() !== '',
    );
    if (kept.some((p) => p.name.trim() === '')) {
      setNameMissing(true);
      return;
    }
    setNameMissing(false);
    const value = (text: string) => (text.trim() === '' ? null : text.trim());
    run(
      {
        vendorId,
        contacts: kept.map((p) => ({
          name: p.name.trim(),
          role: value(p.role),
          phone: value(p.phone),
          email: value(p.email),
        })),
      },
      () => {
        toast.success(t('saved', { name: vendorName }));
        onSaved();
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: vendorName })}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {people.length === 0 ? <p className="text-text-muted">{t('none')}</p> : null}
          {people.map((p, index) => (
            <fieldset
              key={p.key}
              className="border-border flex flex-col gap-3 rounded-md border p-3"
            >
              <legend className="px-1 font-medium">{t('person', { number: index + 1 })}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`person-name-${p.key}`}
                  label={t('name')}
                  error={nameMissing && p.name.trim() === '' ? t('nameMissing') : undefined}
                >
                  <Input
                    value={p.name}
                    maxLength={120}
                    autoComplete="off"
                    onChange={(e) => {
                      change(p.key, 'name', e.currentTarget.value);
                    }}
                  />
                </Field>
                <Field id={`person-role-${p.key}`} label={t('role')}>
                  <Input
                    value={p.role}
                    maxLength={80}
                    autoComplete="off"
                    onChange={(e) => {
                      change(p.key, 'role', e.currentTarget.value);
                    }}
                  />
                </Field>
                <Field id={`person-phone-${p.key}`} label={t('phone')}>
                  <Input
                    value={p.phone}
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    autoComplete="off"
                    onChange={(e) => {
                      change(p.key, 'phone', e.currentTarget.value);
                    }}
                  />
                </Field>
                <Field id={`person-email-${p.key}`} label={t('email')}>
                  <Input
                    value={p.email}
                    type="email"
                    maxLength={254}
                    autoComplete="off"
                    onChange={(e) => {
                      change(p.key, 'email', e.currentTarget.value);
                    }}
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                aria-label={t('removeFor', { number: index + 1 })}
                onClick={() => {
                  setPeople((all) => all.filter((x) => x.key !== p.key));
                }}
              >
                {t('remove')}
              </Button>
            </fieldset>
          ))}
          {people.length < MAX_PEOPLE ? (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                setPeople((all) => [
                  ...all,
                  { key: crypto.randomUUID(), name: '', role: '', phone: '', email: '' },
                ]);
              }}
            >
              {t('add')}
            </Button>
          ) : (
            <p className="text-text-muted">{t('most', { most: MAX_PEOPLE })}</p>
          )}
          <FailureMessage failure={failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Adds an item the vendor supplies: the item, the vendor's own code for it, and whether the
 * vendor is the item's preferred one (marking it takes the mark from another vendor).
 */
export function ItemLinkDialog({
  vendorId,
  vendorName,
  exclude,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  vendorId: string;
  vendorName: string;
  exclude: readonly string[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('procurement.itemForm');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setItemVendor);
  const [item, setItem] = useState<ItemDto | undefined>();
  const [itemMissing, setItemMissing] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (item === undefined) {
      setItemMissing(true);
      return;
    }
    const data = new FormData(e.currentTarget);
    const code = formText(data, 'vendorItemCode').trim();
    run(
      {
        vendorId,
        itemId: item.id,
        vendorItemCode: code === '' ? null : code,
        isPreferred: data.get('isPreferred') === 'on',
      },
      () => {
        toast.success(t('saved', { item: item.name, name: vendorName }));
        onSaved();
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title', { name: vendorName })}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {item === undefined ? (
            <>
              <ItemPicker
                id="vendor-item-search"
                label={t('item')}
                helper={t('itemHelper')}
                noneFound={t('noneFound')}
                chooseLabel={t('choose')}
                chooseFor={(i) => t('chooseFor', { item: i.name })}
                exclude={exclude}
                error={itemMissing ? t('itemMissing') : undefined}
                onChoose={(i) => {
                  setItem(i);
                  setItemMissing(false);
                }}
              />
            </>
          ) : (
            <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <p>
                <span className="font-medium">{item.name}</span>{' '}
                <span className="text-text-muted">{item.sku}</span>
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setItem(undefined);
                }}
              >
                {t('change')}
              </Button>
            </div>
          )}
          <Field id="vendor-item-code" label={t('code')} helper={t('codeHelper')}>
            <Input name="vendorItemCode" maxLength={60} autoComplete="off" />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isPreferred" className="accent-accent size-4" />
            {t('preferred')}
          </label>
          <FailureMessage failure={failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
