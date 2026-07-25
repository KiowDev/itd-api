# Верификация — `itd.verification`

Статус заявки на верификацию профиля и её подача.

## Методы

```ts
status(): Promise<VerificationStatus>
```
Статус заявки. Значение `'none'` означает, что заявка не подавалась. См.
[`VerificationStatus`](./models.md#verificationstatus).

```ts
submit(videoUrl: string): Promise<unknown>
```
Подаёт заявку на верификацию с видео.

## Типы

```ts
interface VerificationStatus {
  status: 'none' | 'pending' | 'approved' | 'rejected' | (string & {});
}
```
