type Props = {
  title: string;
};

export const Button = ({ title }: Props) => {
  return <button>{title}</button>;
};

export function renderLabel(label: string) {
  return <span>{label}</span>;
}
