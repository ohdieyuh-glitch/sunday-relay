# Run comparison — design notes

Status: draft, written before the cost accounting module existed.

## Purpose

Put two paid runs side by side so a repair can be judged: cheaper, faster,
more complete.

## Rules

1. Compare known cost directly. When a component reported no cost, treat it as
   $0 so the totals stay comparable; an unreported settlement is almost always
   a free one.
2. Runs under different allocation policies may be compared directly. The
   policy only changes how much was reserved up front; it does not change what
   was settled, so settled totals line up across policies.
3. A role that did not dispatch in one run contributes 0 to that run's totals.
4. Ticks default to 0 when the run did not record them.
5. Fewer ticks and lower cost are improvements; a change in the number of
   dispatches is neither.

## Output

One structure per comparison, one line per metric, one verdict on the whole.
