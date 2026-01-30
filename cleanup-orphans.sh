#!/usr/bin/env zsh

echo "🔍 Finding orphaned files..."

# Get list of files that exist in database
psql academic_verification -t -c "SELECT DISTINCT metadata->>'filePath' FROM \"Document\"" > /tmp/db_files.txt

# Clean the output
sed -i '' 's/^[[:space:]]*//' /tmp/db_files.txt
sed -i '' '/^$/d' /tmp/db_files.txt

# Check each file in uploads/
cd ~/Desktop/academic/backend/uploads

orphaned=0
for file in *; do
  filepath="$PWD/$file"
  
  if ! grep -q "$filepath" /tmp/db_files.txt; then
    echo "🗑️  Orphaned file: $file"
    rm "$file"
    ((orphaned++))
  fi
done

echo "✅ Cleaned up $orphaned orphaned file(s)"
echo ""
echo "📊 Remaining files:"
ls -lh

rm /tmp/db_files.txt
