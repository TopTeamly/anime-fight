import sys
from PIL import Image
files=sys.argv[2:]; out=sys.argv[1]
ims=[Image.open(f).convert('RGB') for f in files]
w,h=ims[0].size; cols=2; rows=(len(ims)+cols-1)//cols
sheet=Image.new('RGB',(w*cols//1, h*rows))
for i,im in enumerate(ims): sheet.paste(im,((i%cols)*w,(i//cols)*h))
sheet.thumbnail((1600,1600)); sheet.save(out)
