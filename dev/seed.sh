#!/bin/sh
# Popula o MinIO de desenvolvimento com buckets e arquivos de exemplo.
set -e
E="--endpoint-url http://minio:9000"
aws $E s3 mb s3://demo 2>/dev/null || true
aws $E s3 mb s3://backups 2>/dev/null || true
aws $E s3 mb s3://backups-erp 2>/dev/null || true
aws $E s3 sync /seed s3://demo/ --only-show-errors
for i in $(seq 1 30); do
  echo "backup $i" > /tmp/b
  aws $E s3 cp /tmp/b "s3://backups/diario/backup-$i.txt" --only-show-errors
done

# Backups de clientes ERP: clientes/<CNPJ>/<arquivo>
# (o horário do objeto é o do envio; o nome carrega a data de referência)
mk() { # mk <cnpj> <arquivo> <KB>
  dd if=/dev/urandom of=/tmp/f bs=1024 count="$3" 2>/dev/null
  aws $E s3 cp /tmp/f "s3://backups-erp/clientes/$1/$2" --only-show-errors
}
for d in 01 02 03 04 05 06; do
  mk 11222333000181 "padaria-pao-quente_2026-11-$d.bak" $((300 + d * 5))   # saudável
  mk 44555666000172 "mercado-bom-preco_2026-11-$d.fbk" 900                 # vai ficar suspeito
done
mk 44555666000172 "mercado-bom-preco_2026-11-07.fbk" 120                    # queda forte de tamanho
mk 77888999000163 "oficina-auto_2026-11-06.zip" 2                            # abaixo do mínimo
echo "log da rotina" > /tmp/l && aws $E s3 cp /tmp/l s3://backups-erp/clientes/11222333000181/rotina.log --only-show-errors
echo "seed concluído"
