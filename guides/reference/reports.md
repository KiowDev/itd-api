# Жалобы — `itd.reports`

Жалобы на контент и пользователей. Принимает объект или [билдер](./builders.md)
`report`, у которого тип объекта и его идентификатор задаются одновременно.

## Метод

```ts
create(input: ReportInput): Promise<Report>
```
Отправляет жалобу. Повторная жалоба на тот же объект отклоняется сервером. См.
[`Report`](./models.md#report).

## Типы

```ts
type ReportInput = CreateReportInput | ReportBuilder | ((b: ReportBuilder) => ReportBuilder | CreateReportInput);

interface CreateReportInput {
  targetType: ReportTargetType;          // 'post' | 'comment' | 'user'
  targetId: string;
  reason: ReportReason;                  // 'spam' | 'violence' | 'hate' | 'adult' | 'fraud' | 'other'
  description?: string;                  // пояснение в свободной форме
}
```

См. [`ReportTargetType`](./enums.md#reporttargettype), [`ReportReason`](./enums.md#reportreason)
и билдер [`report`](./builders.md).
