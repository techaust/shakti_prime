-- DOM-1, with 0135. An order keeps its customer's type as it was when the order was made
-- (`sales_orders.account_type`): an insert that names none takes the customer's type, as the
-- caller reads the customer, so a customer the caller cannot read leaves it empty and the insert
-- fails; the insert policy of 0135 holds a named one to the customer's type at that moment; no
-- request may change it afterwards (it is not in the update grant of 0117).
create or replace function app.fill_sales_order_account_type() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.account_type is null then
    new.account_type := (select a.type from public.accounts a where a.id = new.account_id);
  end if;
  return new;
end
$$;
--> statement-breakpoint
revoke execute on function app.fill_sales_order_account_type() from public, readonly_reporter;
--> statement-breakpoint
create trigger sales_orders_account_type before insert on sales_orders
  for each row execute function app.fill_sales_order_account_type();
